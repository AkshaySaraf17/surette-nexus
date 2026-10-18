"""Market Lab unit tests: cleaning rules, forecasting, neighbours and the retrieval metrics."""

import numpy as np
import pandas as pd
import pytest

from eval.retrieval_eval import BM25, metrics, rrf
from market_lab import clusters, data, forecast


def raw_rows(**overrides):
    base = {
        "geo_id": "0600000US2300000001",
        "town": "Testville town",
        "county": "Kennebec",
        "population": 1000,
        "population_moe": 10,
        "median_household_income": 60000,
        "median_household_income_moe": 5000,
        "median_home_value": 200000,
        "median_home_value_moe": 20000,
        "median_gross_rent": 1000,
        "median_gross_rent_moe": 100,
        "occupied_units": 400,
        "owner_occupied_units": 300,
        "housing_units": 500,
        "vacant_units": 100,
        "median_age": 45.0,
        "median_year_built": 1974,
    }
    return {**base, **overrides}


def test_cleaning_rules_and_features():
    raw = pd.DataFrame(
        [
            raw_rows(),
            raw_rows(geo_id="2", town="Tiny UT", population=40),  # dropped: < 100 residents
            raw_rows(geo_id="3", town="Coded town", median_gross_rent=-666666666),  # Census code → missing
            raw_rows(geo_id="4", town="Noisy town", median_home_value_moe=150000),  # CV > 30% → not modelled
            raw_rows(geo_id="5", town="Blank town", median_home_value=-666666666),  # no value → not modelled
        ]
    )
    ds = data.clean(raw)
    assert ds.report["tiny_places_dropped"] == 1
    assert ds.report["census_codes_replaced"] == 2
    assert ds.report["unreliable_target"] == 1 and ds.report["missing_target"] == 1
    assert list(ds.model["short_name"]) == ["Testville", "Coded"]
    t = ds.model.iloc[0]
    assert t["owner_rate"] == pytest.approx(0.75) and t["vacancy_rate"] == pytest.approx(0.2)
    assert t["rent_to_income"] == pytest.approx(0.2) and t["housing_age"] == 50
    assert np.isnan(ds.model.iloc[1]["rent_to_income"])  # left for the model pipeline to impute


def test_real_dataset_loads_with_expected_shape():
    ds = data.load()
    assert ds.report["raw_rows"] == 529
    assert 400 < len(ds.model) < 529
    assert ds.model[data.TARGET].notna().all()


def test_naive_and_drift_forecasts():
    s = pd.Series([100.0, 110.0, 121.0], index=[2020, 2021, 2022])
    assert forecast.forecast_growth("Naive", s, 2) == pytest.approx([np.log(1.1)] * 2)
    assert forecast.forecast_growth("Drift", s, 1) == pytest.approx([np.log(1.1)])
    trend = forecast.forecast_growth("Linear trend", s, 1)
    assert trend[0] == pytest.approx(np.log(1.1), rel=1e-6)


def test_backtest_only_uses_past_data():
    years = range(1995, 2016)
    s = pd.Series([100 * 1.05**i for i in range(len(years))], index=list(years))
    bt = forecast.backtest(s)
    assert (bt["origin"] + bt["horizon"] <= 2015).all()
    # Perfect constant growth: naive and drift are exact.
    assert bt[bt.model.isin(["Naive", "Drift"])]["pct_error"].abs().max() < 1e-9


def test_similar_towns_excludes_the_town_itself():
    ds = data.load()
    cl = clusters.run(ds.towns)
    sim = clusters.similar_towns(cl, "Waterville")
    assert len(sim) == 5 and all(s["town"] != "Waterville" for s in sim)
    assert clusters.similar_towns(cl, "Not A Real Town") == []


def test_bm25_ranks_the_matching_document_first():
    bm = BM25(["lake house with a dock", "brick loft downtown", "farm with barn and acres"])
    assert int(np.argmax(bm.scores("dock on the lake"))) == 0
    assert bm.scores("zzz").sum() == 0


def test_ranking_metrics():
    assert metrics([0, 1, 2], {0}) == {"recall@3": 1.0, "mrr": 1.0, "ndcg@5": 1.0}
    assert metrics([2, 1, 0], {0})["mrr"] == pytest.approx(1 / 3)
    assert rrf([0, 1, 2], [1, 2, 0])[0] == 1
