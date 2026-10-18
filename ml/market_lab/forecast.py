"""
House price index outlook (FHFA annual HPI, Maine and Kennebec / Somerset counties).

Models predict next year's growth in the index (log change), then compound it:
  - Naive: next year's growth = this year's
  - Drift: long-run average growth (all years before the forecast origin)
  - Linear trend on log(index)
  - AR(2): linear regression on the last two years' growth
  - Random forest on the last three years' growth

Evaluation is a rolling-origin backtest (time-series cross-validation): for every origin year from
2005 on, fit on data up to that year only, forecast 1 and 2 years ahead, and compare with what
happened. The outlook interval comes from the chosen model's own backtest errors (10th–90th
percentile), not from model assumptions. It describes the county index, not any single home.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression

SEED = 42
FIRST_ORIGIN = 2005
HORIZONS = (1, 2)


def _growth(series: pd.Series) -> pd.Series:
    return np.log(series).diff().dropna()


def _lagged(g: pd.Series, lags: int) -> tuple[np.ndarray, np.ndarray]:
    X = np.column_stack([g.shift(i).values for i in range(1, lags + 1)])[lags:]
    return X, g.values[lags:]


def forecast_growth(model: str, history: pd.Series, steps: int) -> list[float]:
    """Predicted log growth for each of the next `steps` years, given the index history."""
    g = _growth(history)
    if model == "Naive":
        return [float(g.iloc[-1])] * steps
    if model == "Drift":
        return [float(g.mean())] * steps
    if model == "Linear trend":
        years = history.index.values.reshape(-1, 1)
        lr = LinearRegression().fit(years, np.log(history.values))
        future = np.arange(history.index[-1] + 1, history.index[-1] + steps + 1).reshape(-1, 1)
        path = np.concatenate([[lr.predict(years[-1:])[0]], lr.predict(future)])
        return list(np.diff(path))
    lags = 2 if model == "AR(2)" else 3
    X, y = _lagged(g, lags)
    reg = LinearRegression() if model == "AR(2)" else RandomForestRegressor(300, min_samples_leaf=2, random_state=SEED)
    reg.fit(X, y)
    recent, out = list(g.values[-lags:]), []
    for _ in range(steps):  # recursive multi-step forecast
        nxt = float(reg.predict(np.array(recent[::-1][:lags]).reshape(1, -1))[0])
        out.append(nxt)
        recent.append(nxt)
    return out


MODELS = ["Naive", "Drift", "Linear trend", "AR(2)", "Random forest (lags)"]


def backtest(series: pd.Series) -> pd.DataFrame:
    rows = []
    s = series.dropna()
    for origin in range(FIRST_ORIGIN, int(s.index.max())):
        hist = s[s.index <= origin]
        for model in MODELS:
            growth = forecast_growth(model, hist, max(HORIZONS))
            for h in HORIZONS:
                year = origin + h
                if year not in s.index:
                    continue
                predicted = hist.iloc[-1] * np.exp(sum(growth[:h]))
                rows.append({"model": model, "origin": origin, "horizon": h, "actual": s[year], "predicted": predicted, "pct_error": predicted / s[year] - 1})
    return pd.DataFrame(rows)


@dataclass
class Outlook:
    geo: str
    scores: pd.DataFrame  # model × horizon → MAPE
    best: str
    history: pd.Series
    projection: list[dict]  # year, central, low, high


def outlook(series: pd.Series, geo: str) -> Outlook:
    bt = backtest(series)
    scores = bt.assign(ape=bt["pct_error"].abs()).pivot_table(index="model", columns="horizon", values="ape", aggfunc="mean")
    best = scores.mean(axis=1).idxmin()
    s = series.dropna()
    growth = forecast_growth(best, s, max(HORIZONS))
    projection = []
    for h in HORIZONS:
        central = float(s.iloc[-1] * np.exp(sum(growth[:h])))
        errs = bt[(bt.model == best) & (bt.horizon == h)]["pct_error"]
        # predicted = actual·(1+e)  ⇒  actual = predicted/(1+e); the 10th–90th percentile errors give the range.
        lo, hi = central / (1 + errs.quantile(0.9)), central / (1 + errs.quantile(0.1))
        projection.append({"year": int(s.index[-1]) + h, "central": round(central, 1), "low": round(float(lo), 1), "high": round(float(hi), 1)})
    return Outlook(geo, scores, best, s, projection)
