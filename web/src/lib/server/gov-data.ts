import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { GOV_SERIES } from "@/lib/gov-data";
import { invalidateTags } from "./cache";
import { withSystemDb } from "./db";
import { DOWNLOADERS, type DatasetResult, type Observation } from "./gov-download";
import { childLogger } from "./logger";

/**
 * Loads government datasets into market_series / market_observations.
 *
 *  - importSnapshots(): from the checked-in files in data/gov/ (verified against their
 *    SHA-256 checksums in manifest.json) — works offline, used by the seed and CI.
 *  - refreshGovData(): downloads fresh copies from the agencies and imports them — the
 *    worker runs this monthly; failures keep the previous data (nothing is estimated).
 */
const log = childLogger("gov-data");

export interface Manifest {
  generatedAt: string;
  license: string;
  datasets: Record<string, Omit<DatasetResult, "observations"> & { file: string; fileSha256: string; rows: number }>;
}

export function snapshotDir(): string {
  return process.env.GOV_DATA_DIR ?? path.resolve(/*turbopackIgnore: true*/ process.cwd(), "../data/gov");
}

export function toCsv(obs: Observation[]): string {
  return ["series_id,period,value,moe", ...obs.map((o) => `${o.seriesId},${o.period},${o.value},${o.moe ?? ""}`)].join("\n") + "\n";
}

export function parseCsv(text: string): Observation[] {
  const [header, ...lines] = text.trim().split("\n");
  if (header !== "series_id,period,value,moe") throw new Error("Unexpected snapshot header");
  return lines.map((line) => {
    const [seriesId, period, value, moe] = line.split(",");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period) || !Number.isFinite(Number(value))) throw new Error(`Bad snapshot row: ${line}`);
    return { seriesId, period, value: Number(value), moe: moe ? Number(moe) : null };
  });
}

export async function importDataset(result: Omit<DatasetResult, "observations">, observations: Observation[], via: "snapshot" | "live"): Promise<number> {
  const defs = GOV_SERIES.filter((s) => s.dataset === result.dataset);
  const known = new Set(defs.map((s) => s.id));
  const rows = observations.filter((o) => known.has(o.seriesId));
  await withSystemDb(async (db) => {
    for (const s of defs) {
      await db.query(
        `INSERT INTO market_series (id, source, source_series_id, title, units, geography, geo_level, frequency, source_url, original_source, notes, dataset, last_fetched_at, last_error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NULL)
         ON CONFLICT (id) DO UPDATE SET source = EXCLUDED.source, title = EXCLUDED.title, units = EXCLUDED.units, geography = EXCLUDED.geography,
           geo_level = EXCLUDED.geo_level, frequency = EXCLUDED.frequency, source_url = EXCLUDED.source_url, original_source = EXCLUDED.original_source,
           notes = EXCLUDED.notes, dataset = EXCLUDED.dataset, last_fetched_at = EXCLUDED.last_fetched_at, last_error = NULL`,
        [s.id, s.source, s.id.split(":")[1], s.title, s.units, s.geography, s.geoLevel, s.frequency, s.sourceUrl, s.originalSource, s.notes, s.dataset, result.retrievedAt],
      );
    }
    // Batched upsert of observations.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values: unknown[] = [];
      const tuples = chunk.map((o, j) => {
        values.push(o.seriesId, o.period, o.value, o.moe, result.retrievedAt);
        const b = j * 5;
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5})`;
      });
      await db.query(
        `INSERT INTO market_observations (series_id, period, value, moe, retrieved_at) VALUES ${tuples.join(", ")}
         ON CONFLICT (series_id, period) DO UPDATE SET value = EXCLUDED.value, moe = EXCLUDED.moe, retrieved_at = EXCLUDED.retrieved_at`,
        values,
      );
    }
    await db.query(
      `INSERT INTO gov_dataset_imports (dataset, agency, title, source_files, retrieved_at, observations, via) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [result.dataset, result.agency, result.title, JSON.stringify(result.files), result.retrievedAt, rows.length, via],
    );
  });
  await invalidateTags(["market"]);
  return rows.length;
}

/** Import every dataset in data/gov/, refusing files whose checksum doesn't match the manifest. */
export async function importSnapshots(dir = snapshotDir()): Promise<Record<string, number>> {
  const manifest = JSON.parse(readFileSync(path.join(/*turbopackIgnore: true*/ dir, "manifest.json"), "utf8")) as Manifest;
  const out: Record<string, number> = {};
  for (const [name, meta] of Object.entries(manifest.datasets)) {
    const text = readFileSync(path.join(/*turbopackIgnore: true*/ dir, meta.file), "utf8");
    const sha = createHash("sha256").update(text).digest("hex");
    if (sha !== meta.fileSha256) throw new Error(`${meta.file}: checksum mismatch (expected ${meta.fileSha256}, got ${sha})`);
    out[name] = await importDataset(meta, parseCsv(text), "snapshot");
  }
  return out;
}

/** Download fresh data from each agency and import it. One failing source doesn't block the others. */
export async function refreshGovData(): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  for (const [name, fn] of Object.entries(DOWNLOADERS)) {
    try {
      const result = await fn();
      out[name] = await importDataset(result, result.observations, "live");
    } catch (error) {
      out[name] = `failed: ${(error as Error).message}`;
      log.warn({ dataset: name, err: (error as Error).message }, "government dataset refresh failed; keeping previous data");
      await withSystemDb((db) => db.query("UPDATE market_series SET last_error = $2 WHERE dataset = $1", [name, (error as Error).message.slice(0, 500)])).catch(() => undefined);
    }
  }
  return out;
}
