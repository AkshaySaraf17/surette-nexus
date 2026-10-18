"""
Load, clean and engineer features for the Maine towns dataset (Census ACS 2020–2024).

Every cleaning rule is listed in CLEANING_RULES and counted in the returned report, so the notebooks
and docs can show exactly what was removed and why. Nothing is imputed here; models impute inside
their cross-validation pipelines so test folds never leak into training.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

DATA = Path(__file__).resolve().parents[2] / "data" / "gov"
ACS_YEAR = 2024
Z90 = 1.645  # ACS margins of error are at 90% confidence

CLEANING_RULES = {
    "census_codes": "Negative values are Census codes for 'not available' (e.g. -666666666) → missing",
    "tiny_places": "Places with fewer than 100 residents (mostly unorganized territories) are dropped: their estimates are mostly noise",
    "unreliable_target": "Median home value with a coefficient of variation over 30% (MOE ÷ 1.645 ÷ value) is too uncertain to learn from; kept for profiles, excluded from models",
    "missing_target": "No published median home value → excluded from models",
}

FEATURES = [
    "log_population",
    "log_income",
    "rent_to_income",
    "owner_rate",
    "vacancy_rate",
    "median_age",
    "housing_age",
]
FEATURE_LABELS = {
    "log_population": "Population (log)",
    "log_income": "Median household income (log)",
    "rent_to_income": "Annual rent ÷ income",
    "owner_rate": "Homeownership rate",
    "vacancy_rate": "Vacant share of homes (incl. seasonal)",
    "median_age": "Median age of residents",
    "housing_age": "Median age of homes (years)",
}
TARGET = "log_home_value"


@dataclass
class Dataset:
    towns: pd.DataFrame  # every cleaned town (profiles, clustering)
    model: pd.DataFrame  # towns usable for supervised models
    report: dict[str, int] = field(default_factory=dict)


def load_raw() -> pd.DataFrame:
    return pd.read_csv(DATA / "acs5_maine_towns.csv", dtype={"geo_id": str})


def clean(raw: pd.DataFrame) -> Dataset:
    df = raw.copy()
    numeric = df.columns.difference(["geo_id", "town", "county"])
    report = {"raw_rows": len(df)}
    report["census_codes_replaced"] = int((df[numeric] < 0).sum().sum())
    df[numeric] = df[numeric].mask(df[numeric] < 0)

    tiny = df["population"].fillna(0) < 100
    report["tiny_places_dropped"] = int(tiny.sum())
    df = df[~tiny].copy()

    # Features (ratios guard against divide-by-zero by producing NaN, never inf).
    df["owner_rate"] = df["owner_occupied_units"] / df["occupied_units"].replace(0, np.nan)
    df["vacancy_rate"] = df["vacant_units"] / df["housing_units"].replace(0, np.nan)
    df["rent_to_income"] = 12 * df["median_gross_rent"] / df["median_household_income"]
    df["housing_age"] = ACS_YEAR - df["median_year_built"]
    df["log_population"] = np.log(df["population"])
    df["log_income"] = np.log(df["median_household_income"])
    df[TARGET] = np.log(df["median_home_value"])
    df["home_value_cv"] = df["median_home_value_moe"] / Z90 / df["median_home_value"]
    df["short_name"] = df["town"].str.replace(r" (town|city|plantation|UT|CDP)$", "", regex=True)

    missing_target = df["median_home_value"].isna()
    unreliable = ~missing_target & (df["home_value_cv"] > 0.30)
    report["missing_target"] = int(missing_target.sum())
    report["unreliable_target"] = int(unreliable.sum())
    model = df[~missing_target & ~unreliable].copy()
    report["clean_towns"] = len(df)
    report["model_towns"] = len(model)
    report["model_rows_with_missing_features"] = int(model[FEATURES].isna().any(axis=1).sum())
    return Dataset(towns=df.reset_index(drop=True), model=model.reset_index(drop=True), report=report)


def load() -> Dataset:
    return clean(load_raw())


def load_hpi() -> pd.DataFrame:
    """FHFA annual house price index (2000 = 100) for Maine and our two counties, wide by year."""
    hpi = pd.read_csv(DATA / "fhfa_hpi.csv", parse_dates=["period"])
    hpi["geo"] = hpi["series_id"].str.split(":").str[-1]
    hpi["year"] = hpi["period"].dt.year
    return hpi.pivot(index="year", columns="geo", values="value").sort_index()
