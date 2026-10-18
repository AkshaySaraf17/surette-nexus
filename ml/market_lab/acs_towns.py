"""
Download American Community Survey (ACS) 2020–2024 5-year estimates for every Maine town.

Source: U.S. Census Bureau table-based summary files (public domain, no API key). Each table file covers
every geography in the country; it's streamed and only Maine county subdivisions (towns, cities,
plantations, unorganized territories: GEO_ID 0600000US23…) are kept, so nothing large is stored.

Writes data/gov/acs5_maine_towns.csv and a manifest with the URL, size and SHA-256 of every file read,
plus the SHA-256 of the CSV — the same provenance rules as the rest of data/gov.

    cd ml && .venv/bin/python -m market_lab.acs_towns
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from datetime import UTC, datetime
from pathlib import Path

import httpx

VINTAGE = 2024
BASE = f"https://www2.census.gov/programs-surveys/acs/summary_file/{VINTAGE}/table-based-SF"
MAINE_TOWNS = "0600000US23"
OUT = Path(__file__).resolve().parents[2] / "data" / "gov"

# table → {output column: summary-file column}. E = estimate, M = margin of error (90%).
TABLES: dict[str, dict[str, str]] = {
    "b01003": {"population": "B01003_E001", "population_moe": "B01003_M001"},
    "b19013": {"median_household_income": "B19013_E001", "median_household_income_moe": "B19013_M001"},
    "b25077": {"median_home_value": "B25077_E001", "median_home_value_moe": "B25077_M001"},
    "b25064": {"median_gross_rent": "B25064_E001", "median_gross_rent_moe": "B25064_M001"},
    "b25003": {"occupied_units": "B25003_E001", "owner_occupied_units": "B25003_E002"},
    "b25002": {"housing_units": "B25002_E001", "vacant_units": "B25002_E003"},
    "b01002": {"median_age": "B01002_E001"},
    "b25035": {"median_year_built": "B25035_E001"},
}


def stream_filtered(client: httpx.Client, url: str, keep) -> tuple[list[str], list[list[str]], dict]:
    """Stream a pipe-delimited file, keeping the header and rows where keep(first_cell) is true."""
    sha, size, header, rows, buf = hashlib.sha256(), 0, None, [], ""
    with client.stream("GET", url, timeout=300) as r:
        r.raise_for_status()
        for chunk in r.iter_bytes():
            sha.update(chunk)
            size += len(chunk)
            buf += chunk.decode("utf-8", errors="replace")
            *lines, buf = buf.split("\n")
            for line in lines:
                cells = line.rstrip("\r").split("|")
                if header is None:
                    header = cells
                elif keep(cells[0]):
                    rows.append(cells)
    if buf.strip():
        cells = buf.rstrip("\r").split("|")
        if keep(cells[0]):
            rows.append(cells)
    return header or [], rows, {"url": url, "bytes": size, "sha256": sha.hexdigest()}


def main() -> None:
    sources = []
    towns: dict[str, dict[str, str]] = {}
    with httpx.Client(headers={"User-Agent": "surette-nexus market lab (public data research)"}, follow_redirects=True) as client:
        header, rows, meta = stream_filtered(client, f"{BASE}/documentation/Geos{VINTAGE}5YR.txt", lambda c: True)
        sources.append(meta)
        h = {name: i for i, name in enumerate(header)}
        for r in rows:
            geo = r[h["GEO_ID"]] if "GEO_ID" in h else ""
            if geo.startswith(MAINE_TOWNS):
                name = r[h["NAME"]]  # e.g. "Waterville city, Kennebec County, Maine"
                town, county = (name.split(", ") + ["", ""])[:2]
                towns[geo] = {"geo_id": geo, "town": town, "county": county.replace(" County", "")}
        print(f"geographies: {len(towns)} Maine county subdivisions")
        for table, cols in TABLES.items():
            header, rows, meta = stream_filtered(client, f"{BASE}/data/5YRData/acsdt5y{VINTAGE}-{table}.dat", lambda c: c.startswith(MAINE_TOWNS))
            sources.append(meta)
            h = {name: i for i, name in enumerate(header)}
            for r in rows:
                if r[0] in towns:
                    for out, col in cols.items():
                        towns[r[0]][out] = r[h[col]]
            print(f"{table}: {len(rows)} rows, {meta['bytes'] / 1e6:.1f} MB streamed")

    columns = ["geo_id", "town", "county", *[c for cols in TABLES.values() for c in cols]]
    text = io.StringIO()
    w = csv.DictWriter(text, fieldnames=columns, lineterminator="\n")
    w.writeheader()
    for geo in sorted(towns):
        w.writerow({c: towns[geo].get(c, "") for c in columns})
    data = text.getvalue().encode()
    (OUT / "acs5_maine_towns.csv").write_bytes(data)
    manifest = {
        "dataset": "acs5_maine_towns",
        "title": f"American Community Survey {VINTAGE - 4}–{VINTAGE} 5-year estimates, all Maine county subdivisions",
        "publisher": "U.S. Census Bureau (public domain)",
        "retrieved_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "notes": "Raw values as published. Negative numbers are Census codes for 'not available' and are cleaned in market_lab/data.py, never here.",
        "sources": sources,
        "csv_sha256": hashlib.sha256(data).hexdigest(),
        "rows": len(towns),
    }
    (OUT / "acs5_maine_towns.manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(towns)} towns → data/gov/acs5_maine_towns.csv")


if __name__ == "__main__":
    main()
