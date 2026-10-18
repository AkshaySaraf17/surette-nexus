/**
 * Government datasets behind the market dashboards. Every series is downloaded directly
 * from the publishing agency (no keys, no intermediaries), stored with its provenance, and
 * never estimated or filled in. Downloader: scripts/gov-data/download.ts. Snapshot files:
 * data/gov/ (see data/gov/README.md). Importer: lib/server/gov-data.ts.
 *
 *  - U.S. Census Bureau, American Community Survey 5-year estimates (2020–2024),
 *    table-based summary files from www2.census.gov
 *  - U.S. Bureau of Labor Statistics, Local Area Unemployment Statistics (api.bls.gov)
 *  - U.S. Census Bureau, Building Permits Survey (www2.census.gov/econ/bps)
 *  - Federal Housing Finance Agency, annual House Price Index for counties and states (fhfa.gov)
 *
 * All are U.S. Government works (public domain).
 */
export type GeoLevel = "national" | "state" | "county" | "town";

export interface GovGeo {
  key: string;
  name: string;
  level: GeoLevel;
  acsGeoId: string; // GEO_ID in the ACS summary files
}

/** Geographies we report on: the nation, Maine, our two counties and the towns we list in. */
export const GOV_GEOS: GovGeo[] = [
  { key: "us", name: "United States", level: "national", acsGeoId: "0100000US" },
  { key: "maine", name: "Maine", level: "state", acsGeoId: "0400000US23" },
  { key: "kennebec", name: "Kennebec County, ME", level: "county", acsGeoId: "0500000US23011" },
  { key: "somerset", name: "Somerset County, ME", level: "county", acsGeoId: "0500000US23025" },
  { key: "waterville", name: "Waterville", level: "town", acsGeoId: "0600000US2301180740" },
  { key: "augusta", name: "Augusta", level: "town", acsGeoId: "0600000US2301102100" },
  { key: "winslow", name: "Winslow", level: "town", acsGeoId: "0600000US2301186515" },
  { key: "oakland", name: "Oakland", level: "town", acsGeoId: "0600000US2301154560" },
  { key: "sidney", name: "Sidney", level: "town", acsGeoId: "0600000US2301168385" },
  { key: "belgrade", name: "Belgrade", level: "town", acsGeoId: "0600000US2301104020" },
  { key: "fairfield", name: "Fairfield", level: "town", acsGeoId: "0600000US2302524320" },
];

export const ACS_VINTAGE = 2024; // 2020–2024 5-year estimates
export const ACS_TABLES = ["b01003", "b19013", "b25077", "b25064", "b25003"] as const;

export interface GovSeriesDef {
  id: string;
  dataset: "acs5" | "bls_laus" | "census_bps" | "fhfa_hpi";
  metric: string;
  title: string;
  units: string;
  geography: string;
  geoLevel: GeoLevel;
  frequency: string;
  source: string;
  originalSource: string;
  sourceUrl: string;
  notes: string;
}

const ACS_METRICS = [
  { metric: "population", title: "Total population", units: "people", variable: "B01003_E001" },
  { metric: "median_household_income", title: "Median household income", units: "dollars", variable: "B19013_E001" },
  { metric: "median_home_value", title: "Median value of owner-occupied homes", units: "dollars", variable: "B25077_E001" },
  { metric: "median_gross_rent", title: "Median gross rent", units: "dollars", variable: "B25064_E001" },
  { metric: "homeownership_rate", title: "Homeownership rate", units: "percent", variable: "B25003_E002/B25003_E001" },
] as const;

const acs = ACS_METRICS.flatMap((m) =>
  GOV_GEOS.map<GovSeriesDef>((g) => ({
    id: `acs:${m.metric}:${g.key}`,
    dataset: "acs5",
    metric: m.metric,
    title: m.title,
    units: m.units,
    geography: g.name,
    geoLevel: g.level,
    frequency: "annual (5-year estimate)",
    source: "U.S. Census Bureau",
    originalSource: `American Community Survey ${ACS_VINTAGE - 4}–${ACS_VINTAGE} 5-year estimates (${m.variable})`,
    sourceUrl: "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/",
    notes: "5-year estimates describe the whole period and carry a margin of error (shown as ±, 90% confidence). Small towns have wide margins. Context only — never used to filter or rank homes.",
  })),
);

const LAUS: { key: string; seriesId: string; name: string; level: GeoLevel }[] = [
  { key: "kennebec", seriesId: "LAUCN230110000000003", name: "Kennebec County, ME", level: "county" },
  { key: "somerset", seriesId: "LAUCN230250000000003", name: "Somerset County, ME", level: "county" },
  { key: "maine", seriesId: "LASST230000000000003", name: "Maine", level: "state" },
  { key: "us", seriesId: "LNU04000000", name: "United States", level: "national" },
];
export const LAUS_SERIES = LAUS;

const bls = LAUS.map<GovSeriesDef>((l) => ({
  id: `bls:unemployment_rate:${l.key}`,
  dataset: "bls_laus",
  metric: "unemployment_rate",
  title: "Unemployment rate",
  units: "percent",
  geography: l.name,
  geoLevel: l.level,
  frequency: "monthly",
  source: "U.S. Bureau of Labor Statistics",
  originalSource: `Local Area Unemployment Statistics (${l.seriesId})`,
  sourceUrl: `https://data.bls.gov/timeseries/${l.seriesId}`,
  // BLS series ids: LAU…/LNU… are not seasonally adjusted; LAS… (the statewide series) is.
  notes: `${l.seriesId.startsWith("LAS") ? "Seasonally adjusted by BLS (the county and U.S. lines are not), so it doesn't show Maine's winter rise." : "Not seasonally adjusted, so compare the same month across years."} The latest month is preliminary and is revised. October 2025 was never collected (federal government shutdown), so that month is blank.`,
}));

export const BPS_GEOS = [
  { key: "kennebec", name: "Kennebec County, ME", level: "county" as const, state: "23", county: "011" },
  { key: "somerset", name: "Somerset County, ME", level: "county" as const, state: "23", county: "025" },
  { key: "maine", name: "Maine", level: "state" as const, state: "23", county: null },
];
const bps = BPS_GEOS.map<GovSeriesDef>((g) => ({
  id: `bps:units_authorized:${g.key}`,
  dataset: "census_bps",
  metric: "building_permits",
  title: "New housing units authorized by building permits",
  units: "units",
  geography: g.name,
  geoLevel: g.level,
  frequency: "annual",
  source: "U.S. Census Bureau",
  originalSource: "Building Permits Survey, annual (estimates with imputation)",
  sourceUrl: "https://www2.census.gov/econ/bps/",
  notes: "Privately owned units in permitted buildings (1-unit, 2-unit, 3–4 and 5+ combined). Permits lead construction; not every permit is built.",
}));

export const FHFA_GEOS = [
  { key: "kennebec", name: "Kennebec County, ME", level: "county" as const, fips: "23011" },
  { key: "somerset", name: "Somerset County, ME", level: "county" as const, fips: "23025" },
  { key: "maine", name: "Maine", level: "state" as const, state: "ME" },
];
const fhfa = FHFA_GEOS.map<GovSeriesDef>((g) => ({
  id: `fhfa:hpi_annual:${g.key}`,
  dataset: "fhfa_hpi",
  metric: "hpi_county",
  title: "House Price Index, annual (2000 = 100)",
  units: "index (2000 = 100)",
  geography: g.name,
  geoLevel: g.level,
  frequency: "annual",
  source: "Federal Housing Finance Agency",
  originalSource: "FHFA HPI, all-transactions, annual" + (g.level === "county" ? " (developmental county series)" : ""),
  sourceUrl: "https://www.fhfa.gov/data/hpi/datasets",
  notes: "Repeat-sales index of the same homes over time — it measures change, not price levels. County indexes use small samples and are labelled developmental by FHFA.",
}));

export const GOV_SERIES: GovSeriesDef[] = [...acs, ...bls, ...bps, ...fhfa];
export const GOV_SERIES_BY_ID = new Map(GOV_SERIES.map((s) => [s.id, s]));
