import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { ACS_TABLES, ACS_VINTAGE, BPS_GEOS, FHFA_GEOS, GOV_GEOS, LAUS_SERIES } from "@/lib/gov-data";
import { breaker } from "./circuit-breaker";

/**
 * Downloads the government datasets straight from the agencies (no API keys) and turns
 * them into observations. Used by `npm run data:gov:download` (writes data/gov/ snapshots)
 * and by the worker's monthly `govdata.refresh` job (imports directly).
 */
export interface Observation {
  seriesId: string;
  period: string; // YYYY-MM-DD
  value: number;
  moe: number | null;
}
export interface SourceFile {
  url: string;
  bytes: number;
  sha256: string;
}
export interface DatasetResult {
  dataset: "acs5" | "bls_laus" | "census_bps" | "fhfa_hpi";
  agency: string;
  title: string;
  retrievedAt: string;
  files: SourceFile[];
  observations: Observation[];
  notes?: string[];
}

const UA = "SuretteNexus/1.0 (market dashboards; contact via repository)";
const gov = breaker("gov-data", { failureThreshold: 6, resetAfterMs: 5 * 60_000, timeoutMs: 120_000 });

async function download(url: string, init: RequestInit = {}): Promise<{ bytes: Uint8Array; file: SourceFile } | null> {
  const res = await gov.exec((signal) => fetch(url, { ...init, signal, headers: { "User-Agent": UA, ...(init.headers ?? {}) }, redirect: "follow", cache: "no-store" }));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, file: { url, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------------------------------
// Census ACS 5-year, table-based summary files (pipe-delimited, all geographies per table)
// ---------------------------------------------------------------------------------------
export async function downloadAcs(): Promise<DatasetResult> {
  const wanted = new Map(GOV_GEOS.map((g) => [g.acsGeoId, g.key]));
  const values = new Map<string, Record<string, number>>(); // geoKey → column → value
  const files: SourceFile[] = [];
  for (const table of ACS_TABLES) {
    const url = `https://www2.census.gov/programs-surveys/acs/summary_file/${ACS_VINTAGE}/table-based-SF/data/5YRData/acsdt5y${ACS_VINTAGE}-${table}.dat`;
    const got = await download(url);
    if (!got) throw new Error(`ACS table ${table} not found for ${ACS_VINTAGE}`);
    files.push(got.file);
    const text = strFromU8(got.bytes);
    const [header, ...lines] = text.split("\n");
    const cols = header.trim().split("|");
    for (const line of lines) {
      const sep = line.indexOf("|");
      const geoKey = wanted.get(line.slice(0, sep));
      if (!geoKey) continue;
      const cells = line.trim().split("|");
      const row = values.get(geoKey) ?? {};
      cols.forEach((c, i) => {
        if (i > 0) row[c] = Number(cells[i]);
      });
      values.set(geoKey, row);
    }
  }
  const period = `${ACS_VINTAGE}-01-01`;
  const observations: Observation[] = [];
  const valid = (n: number | undefined) => typeof n === "number" && Number.isFinite(n) && n >= 0; // Census uses negative codes for "not available"
  for (const g of GOV_GEOS) {
    const r = values.get(g.key);
    if (!r) continue;
    const push = (metric: string, v: number | undefined, m: number | undefined) => {
      if (valid(v)) observations.push({ seriesId: `acs:${metric}:${g.key}`, period, value: v!, moe: valid(m) ? m! : null });
    };
    push("population", r.B01003_E001, r.B01003_M001);
    push("median_household_income", r.B19013_E001, r.B19013_M001);
    push("median_home_value", r.B25077_E001, r.B25077_M001);
    push("median_gross_rent", r.B25064_E001, r.B25064_M001);
    // Homeownership = owner-occupied / occupied units. MOE of a proportion (Census ACS handbook):
    // sqrt(MOE_x² − p²·MOE_y²) / y, falling back to the ratio formula if the radicand is negative.
    const x = r.B25003_E002, y = r.B25003_E001, mx = r.B25003_M002, my = r.B25003_M001;
    if (valid(x) && valid(y) && y > 0) {
      const p = x / y;
      let rad = (mx ?? 0) ** 2 - p ** 2 * (my ?? 0) ** 2;
      if (rad < 0) rad = (mx ?? 0) ** 2 + p ** 2 * (my ?? 0) ** 2;
      observations.push({ seriesId: `acs:homeownership_rate:${g.key}`, period, value: round(p * 100, 1), moe: round((Math.sqrt(rad) / y) * 100, 1) });
    }
  }
  return {
    dataset: "acs5",
    agency: "U.S. Census Bureau",
    title: `American Community Survey ${ACS_VINTAGE - 4}–${ACS_VINTAGE} 5-year estimates (tables ${ACS_TABLES.map((t) => t.toUpperCase()).join(", ")})`,
    retrievedAt: new Date().toISOString(),
    files,
    observations,
  };
}

// ---------------------------------------------------------------------------------------
// BLS Local Area Unemployment Statistics (public API v1, no key; 10 years per request)
// ---------------------------------------------------------------------------------------
export async function downloadLaus(now = new Date()): Promise<DatasetResult> {
  const endyear = now.getUTCFullYear();
  const startyear = endyear - 9;
  const url = "https://api.bls.gov/publicAPI/v1/timeseries/data/";
  const body = JSON.stringify({ seriesid: LAUS_SERIES.map((s) => s.seriesId), startyear: String(startyear), endyear: String(endyear) });
  const got = await download(url, { method: "POST", body, headers: { "Content-Type": "application/json" } });
  if (!got) throw new Error("BLS API not found");
  const json = JSON.parse(strFromU8(got.bytes)) as {
    status: string;
    message?: string[];
    Results?: { series: { seriesID: string; data: { year: string; period: string; value: string; footnotes: { code?: string }[] }[] }[] };
  };
  if (json.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS: ${json.status} ${json.message?.join(" ") ?? ""}`);
  const observations: Observation[] = [];
  const notes: string[] = [];
  for (const s of json.Results?.series ?? []) {
    const def = LAUS_SERIES.find((l) => l.seriesId === s.seriesID);
    if (!def) continue;
    for (const d of s.data) {
      if (!/^M(0[1-9]|1[0-2])$/.test(d.period)) continue; // skip annual averages (M13)
      const value = Number(d.value);
      if (!Number.isFinite(value)) continue;
      observations.push({ seriesId: `bls:unemployment_rate:${def.key}`, period: `${d.year}-${d.period.slice(1)}-01`, value, moe: null });
      if (d.footnotes.some((f) => f.code === "P")) notes.push(`${def.key} ${d.year}-${d.period.slice(1)} preliminary`);
    }
  }
  observations.sort((a, b) => a.seriesId.localeCompare(b.seriesId) || a.period.localeCompare(b.period));
  return {
    dataset: "bls_laus",
    agency: "U.S. Bureau of Labor Statistics",
    title: `Local Area Unemployment Statistics, monthly, ${startyear}–${endyear} (not seasonally adjusted)`,
    retrievedAt: new Date().toISOString(),
    files: [{ ...got.file, url: `${url} (POST ${LAUS_SERIES.map((s) => s.seriesId).join(", ")})` }],
    observations,
    notes,
  };
}

// ---------------------------------------------------------------------------------------
// Census Building Permits Survey — annual county and state text files
// ---------------------------------------------------------------------------------------
export async function downloadBps(now = new Date(), years = 10): Promise<DatasetResult> {
  const files: SourceFile[] = [];
  const observations: Observation[] = [];
  const last = now.getUTCFullYear() - 1;
  for (let year = last - years + 1; year <= last; year++) {
    const county = await download(`https://www2.census.gov/econ/bps/County/co${year}a.txt`);
    const state = await download(`https://www2.census.gov/econ/bps/State/st${year}a.txt`);
    if (!county || !state) continue; // the newest year appears in spring
    files.push(county.file, state.file);
    for (const line of strFromU8(county.bytes).split("\n")) {
      const c = line.split(",");
      const geo = BPS_GEOS.find((g) => g.county && c[1] === g.state && c[2] === g.county);
      if (!geo) continue;
      const units = [7, 10, 13, 16].reduce((sum, i) => sum + Number(c[i] || 0), 0);
      observations.push({ seriesId: `bps:units_authorized:${geo.key}`, period: `${year}-01-01`, value: units, moe: null });
    }
    for (const line of strFromU8(state.bytes).split("\n")) {
      const c = line.split(",");
      const geo = BPS_GEOS.find((g) => !g.county && c[1] === g.state);
      if (!geo || !/^\d{4}/.test(c[0])) continue;
      const units = [6, 9, 12, 15].reduce((sum, i) => sum + Number(c[i] || 0), 0);
      observations.push({ seriesId: `bps:units_authorized:${geo.key}`, period: `${year}-01-01`, value: units, moe: null });
    }
  }
  if (!observations.length) throw new Error("No building permit data found");
  return {
    dataset: "census_bps",
    agency: "U.S. Census Bureau",
    title: "Building Permits Survey, annual county and state totals",
    retrievedAt: new Date().toISOString(),
    files,
    observations,
  };
}

// ---------------------------------------------------------------------------------------
// FHFA House Price Index — annual county and state workbooks (.xlsx)
// ---------------------------------------------------------------------------------------
function readXlsx(bytes: Uint8Array): string[][] {
  const zip = unzipSync(bytes, { filter: (f) => f.name === "xl/sharedStrings.xml" || f.name === "xl/worksheets/sheet1.xml" });
  const shared = [...strFromU8(zip["xl/sharedStrings.xml"] ?? new Uint8Array()).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
  const sheet = strFromU8(zip["xl/worksheets/sheet1.xml"]);
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const out: string[] = [];
    for (const c of row[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>(?:<f>[\s\S]*?<\/f>)?(?:<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>)/g)) {
      const col = c[1].split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const v = c[3] ?? "";
      out[col] = c[2].includes('t="s"') ? shared[Number(v)] ?? "" : v;
    }
    rows.push(out.map((x) => x ?? ""));
  }
  return rows;
}

export async function downloadFhfa(): Promise<DatasetResult> {
  const files: SourceFile[] = [];
  const observations: Observation[] = [];
  const county = await download("https://www.fhfa.gov/hpi/download/annual/hpi_at_county.csv"); // served as .xlsx
  const state = await download("https://www.fhfa.gov/hpi/download/annual/hpi_at_state.csv");
  if (!county || !state) throw new Error("FHFA annual HPI files not found");
  files.push(county.file, state.file);

  const pick = (rows: string[][], match: (r: string[], h: Record<string, number>) => string | null) => {
    const hi = rows.findIndex((r) => r.some((c) => /^Year$/i.test(c.trim())));
    const h = Object.fromEntries(rows[hi].map((c, i) => [c.trim(), i]));
    const base2000 = rows[hi].findIndex((c) => /2000 base/i.test(c));
    for (const r of rows.slice(hi + 1)) {
      const key = match(r, h);
      if (!key) continue;
      const value = Number(r[base2000]);
      const year = Number(r[h.Year]);
      if (Number.isFinite(value) && value > 0 && year > 1900) observations.push({ seriesId: `fhfa:hpi_annual:${key}`, period: `${year}-01-01`, value, moe: null });
    }
  };
  pick(readXlsx(county.bytes), (r, h) => FHFA_GEOS.find((g) => "fips" in g && r[h["FIPS code"]] === g.fips)?.key ?? null);
  pick(readXlsx(state.bytes), (r, h) => FHFA_GEOS.find((g) => "state" in g && (r[h.Abbreviation] === g.state || r[h.State] === g.state))?.key ?? null);
  if (!observations.length) throw new Error("FHFA workbooks had no matching rows");
  return {
    dataset: "fhfa_hpi",
    agency: "Federal Housing Finance Agency",
    title: "House Price Index (all-transactions), annual, counties and states — 2000 base",
    retrievedAt: new Date().toISOString(),
    files,
    observations,
  };
}

export const DOWNLOADERS = { acs5: downloadAcs, bls_laus: downloadLaus, census_bps: downloadBps, fhfa_hpi: downloadFhfa };
