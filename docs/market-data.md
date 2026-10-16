# Market data

`/market`, the portal dashboard's "Local market" card and the concierge read the series stored in
`market_series` / `market_observations`. Every value carries its source and retrieval time; nothing
is estimated or filled in.

## Government datasets (downloaded directly, no keys)

| Agency | Dataset | Measures | Areas | Refresh |
| --- | --- | --- | --- | --- |
| U.S. Census Bureau | American Community Survey 2020–2024 5-year (bulk summary files, www2.census.gov) | Median home value, median rent, median household income, homeownership rate, population, each with a margin of error | Waterville, Augusta, Winslow, Oakland, Sidney, Belgrade, Fairfield, Kennebec and Somerset counties, Maine, U.S. | Monthly check (new vintage each December) |
| U.S. Bureau of Labor Statistics | Local Area Unemployment Statistics (api.bls.gov, public v1) | Monthly unemployment rate, not seasonally adjusted | Kennebec and Somerset counties, Maine, U.S. | Monthly |
| U.S. Census Bureau | Building Permits Survey (www2.census.gov/econ/bps) | New housing units authorized per year | Kennebec and Somerset counties, Maine | Monthly check (annual data) |
| Federal Housing Finance Agency | Annual House Price Index (fhfa.gov) | All-transactions index, 2000 = 100 | Kennebec and Somerset counties, Maine | Monthly check (annual data) |

Snapshots of these downloads, with source URLs and SHA-256 checksums, are checked in at
[`data/gov/`](../data/gov/README.md), so the dashboards work offline and the seed loads real numbers. The
worker refreshes them monthly from the agencies (`govdata.refresh`). Provenance is public at
`GET /api/market/datasets`.

Known gap: BLS did not collect October 2025 (federal government shutdown). That month is blank and is
never interpolated.

## FRED (Federal Reserve Bank of St. Louis), daily

17 series: the Freddie Mac 30-year mortgage rate; FHFA quarterly house price indexes; the Census/HUD
median sales price; and Realtor.com listing prices, inventory, new and pending listings, and days on market
for Kennebec County, Maine and the U.S. These come from public CSV downloads, with no key needed.

## Commands

```bash
cd web
npm run data:gov:download   # fetch fresh copies from the agencies → data/gov/
npm run data:gov:import     # load data/gov/ into the database
npm run market:refresh      # refresh FRED now
```

A Census API key is **not** needed. The bulk summary files are public; the keyed Census API is no longer used.
