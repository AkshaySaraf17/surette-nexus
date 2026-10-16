# Government datasets (snapshots)

Real data for the market dashboards, downloaded **directly from U.S. government agencies** with no
API keys. They are U.S. Government works, so public domain.

| File | Agency | What | Geographies |
| --- | --- | --- | --- |
| `acs5.csv` | U.S. Census Bureau | American Community Survey 2020–2024 5-year estimates: population, median household income, median home value, median gross rent, homeownership rate, each with its margin of error | U.S., Maine, Kennebec and Somerset counties, Waterville, Augusta, Winslow, Oakland, Sidney, Belgrade, Fairfield |
| `bls_laus.csv` | U.S. Bureau of Labor Statistics | Local Area Unemployment Statistics, monthly unemployment rate (not seasonally adjusted), last 10 years | U.S., Maine, Kennebec and Somerset counties |
| `census_bps.csv` | U.S. Census Bureau | Building Permits Survey: new housing units authorized per year, last 10 years | Maine, Kennebec and Somerset counties |
| `fhfa_hpi.csv` | Federal Housing Finance Agency | Annual House Price Index (all-transactions, 2000 = 100) | Maine, Kennebec and Somerset counties |

`manifest.json` records, for each dataset, every source file that was downloaded (URL, size,
SHA-256), when, and the SHA-256 of the CSV written here. The importer refuses a CSV whose checksum
doesn't match, so the dashboards show exactly what the agencies published.

CSV format: `series_id,period,value,moe`. Series ids and their metadata (titles, units, notes)
are defined in `web/src/lib/gov-data.ts`. `moe` is the Census margin of error (90 % confidence),
and is empty for sources that don't publish one.

```bash
cd web
npm run data:gov:download          # re-download everything from the agencies and rewrite these files
npm run data:gov:download -- acs5  # just one dataset (acs5 | bls_laus | census_bps | fhfa_hpi)
npm run data:gov:import            # load these snapshots into the database (the seed does this too)
```

In production the worker downloads fresh copies monthly (`govdata.refresh` job) and imports them
directly. If a source is down, the previous values stay and the error is recorded; nothing is
estimated. Public provenance: `GET /api/market/datasets`.

Sources:
- ACS summary files: https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/
- BLS LAUS: https://www.bls.gov/lau/ (series LAUCN230110000000003, LAUCN230250000000003, LASST230000000000003, LNU04000000)
- Building Permits Survey: https://www2.census.gov/econ/bps/
- FHFA HPI: https://www.fhfa.gov/data/hpi/datasets
