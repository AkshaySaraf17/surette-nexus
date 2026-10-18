"""
Build the Market Lab: train and evaluate every model, record runs in MLflow, and write the results the
website shows (data/insights/market_lab.json) plus the figures used in the docs.

    cd ml && .venv/bin/python -m market_lab.build
    .venv/bin/mlflow ui --backend-store-uri sqlite:///mlruns/mlflow.db     # browse the experiments

Inputs are the public datasets in data/gov (Census ACS for all Maine towns, FHFA price index).
"""

from __future__ import annotations

import hashlib
import json
import warnings
from datetime import UTC, datetime
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import mlflow  # noqa: E402
import numpy as np  # noqa: E402
import seaborn as sns  # noqa: E402

from . import clusters, data, forecast, models  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "insights" / "market_lab.json"
FIGS = ROOT / "docs" / "market-lab"
MLRUNS = Path(__file__).resolve().parents[1] / "mlruns"
# Towns Surette lists in (the website shows these).
LISTED_TOWNS = ["Waterville", "Augusta", "Winslow", "Oakland", "Sidney", "Belgrade", "Fairfield"]


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def figures(ds: data.Dataset, reg: models.RegressionResult, cl: clusters.ClusterResult, outlooks: list[forecast.Outlook]) -> None:
    FIGS.mkdir(parents=True, exist_ok=True)
    sns.set_theme(style="whitegrid", context="notebook")

    fig, ax = plt.subplots(figsize=(7, 4.5))
    m = ds.model
    sns.scatterplot(x=np.exp(m["log_income"]) / 1000, y=m["median_home_value"] / 1000, hue=m["vacancy_rate"], palette="viridis", s=22, ax=ax, edgecolor="none")
    ax.set(xlabel="Median household income ($k)", ylabel="Median home value ($k)", title="Maine towns: income vs home value (color = seasonal-home share)")
    fig.tight_layout(), fig.savefig(FIGS / "income-vs-value.png", dpi=150), plt.close(fig)

    fig, ax = plt.subplots(figsize=(6, 4))
    t = reg.table
    sns.barplot(data=t, y="model", x="r2", color="#86602a", ax=ax)
    ax.set(xlabel="R² (nested 5-fold cross-validation)", ylabel="", title="Predicting a town's median home value")
    fig.tight_layout(), fig.savefig(FIGS / "model-comparison.png", dpi=150), plt.close(fig)

    fig, ax = plt.subplots(figsize=(7, 5))
    towns = cl.towns
    for c, name in cl.names.items():
        sel = towns[towns.cluster == c]
        ax.scatter(sel.pc1, sel.pc2, s=14, label=f"{name} ({len(sel)})")
    for t in LISTED_TOWNS:
        row = towns[towns.short_name == t]
        if len(row):
            ax.annotate(t, (row.pc1.iloc[0], row.pc2.iloc[0]), fontsize=8, weight="bold")
    ax.set(xlabel=f"PC1 ({cl.explained[0]:.0%} of variation)", ylabel=f"PC2 ({cl.explained[1]:.0%})", title="Maine towns on two principal components, colored by K-Means group")
    ax.legend(fontsize=7, loc="best")
    fig.tight_layout(), fig.savefig(FIGS / "town-map-pca.png", dpi=150), plt.close(fig)

    fig, axes = plt.subplots(1, len(outlooks), figsize=(11, 3.6), sharey=False)
    for ax, o in zip(axes, outlooks, strict=True):
        h = o.history[o.history.index >= 2000]
        ax.plot(h.index, h.values, color="#15130f")
        years = [h.index[-1]] + [p["year"] for p in o.projection]
        ax.plot(years, [h.iloc[-1]] + [p["central"] for p in o.projection], "--", color="#86602a")
        ax.fill_between(years, [h.iloc[-1]] + [p["low"] for p in o.projection], [h.iloc[-1]] + [p["high"] for p in o.projection], color="#86602a", alpha=0.2)
        ax.set(title=f"{o.geo.title()} ({o.best})", xlabel="")
    axes[0].set_ylabel("FHFA price index (2000 = 100)")
    fig.tight_layout(), fig.savefig(FIGS / "price-index-outlook.png", dpi=150), plt.close(fig)


def main() -> None:
    warnings.filterwarnings("ignore")
    ds = data.load()
    MLRUNS.mkdir(exist_ok=True)
    mlflow.set_tracking_uri(f"sqlite:///{MLRUNS / 'mlflow.db'}")
    mlflow.set_experiment("market-lab")
    inputs = {"acs5_maine_towns.csv": sha(data.DATA / "acs5_maine_towns.csv"), "fhfa_hpi.csv": sha(data.DATA / "fhfa_hpi.csv")}

    with mlflow.start_run(run_name="home-value-regression"):
        reg = models.run_regression(ds.model)
        mlflow.log_params({"towns": len(ds.model), "features": ",".join(data.FEATURES), "cv": "nested 5x4 KFold", "best_model": reg.best_name, **{f"best_{k}": v for k, v in reg.best_params.items()}})
        mlflow.set_tags({f"input_sha256_{k}": v for k, v in inputs.items()})
        for _, r in reg.table.iterrows():
            key = r["model"].split(" (")[0].lower().replace(" ", "_")
            mlflow.log_metrics({f"{key}_rmse_log": r["rmse_log"], f"{key}_r2": r["r2"], f"{key}_median_abs_pct_error": r["median_abs_pct_error"]})
        mlflow.sklearn.log_model(reg.final, name="model", input_example=ds.model[data.FEATURES + ["county"]].head(3))

    with mlflow.start_run(run_name="above-median-classification"):
        cls = models.run_classification(ds.model)
        mlflow.log_params({"threshold_dollars": round(cls.threshold_dollars), "cv": "nested stratified 5x4"})
        for _, r in cls.table.iterrows():
            key = r["model"].split(" (")[0].lower().replace(" ", "_")
            mlflow.log_metrics({f"{key}_roc_auc": r["roc_auc"], f"{key}_accuracy": r["accuracy"], f"{key}_f1": r["f1"]})

    with mlflow.start_run(run_name="town-clusters"):
        cl = clusters.run(ds.towns)
        mlflow.log_params({"k": cl.k, "features": ",".join(clusters.PROFILE)})
        mlflow.log_metrics({f"silhouette_k{k}": v for k, v in cl.silhouettes.items()} | {"pca_explained_2d": sum(cl.explained)})

    hpi = data.load_hpi()
    outlooks = []
    with mlflow.start_run(run_name="price-index-backtest"):
        for geo in ["maine", "kennebec", "somerset"]:
            o = forecast.outlook(hpi[geo], geo)
            outlooks.append(o)
            mlflow.log_param(f"{geo}_best", o.best)
            for model, row in o.scores.iterrows():
                key = model.split(" (")[0].lower().replace(" ", "_").replace("(", "").replace(")", "")
                mlflow.log_metrics({f"{geo}_{key}_mape_h{h}": float(v) for h, v in row.items()})

    figures(ds, reg, cl, outlooks)

    # ---- results for the website ----
    m = ds.model.assign(predicted=np.exp(reg.oof))
    typical_error = float(reg.table.loc[reg.table.model == reg.best_name, "median_abs_pct_error"].iloc[0])
    towns_out = []
    for t in LISTED_TOWNS:
        row = cl.towns[cl.towns.short_name == t]
        mrow = m[m.short_name == t]
        if not len(row):
            continue
        r = row.iloc[0]
        entry = {
            "town": t,
            "county": r["county"],
            "group": cl.names[int(r["cluster"])],
            "similar": clusters.similar_towns(cl, t),
            "median_home_value": int(r["median_home_value"]),
            "median_home_value_moe": int(r["median_home_value_moe"]),
        }
        if len(mrow):
            pred = float(mrow["predicted"].iloc[0])
            entry["expected_home_value"] = int(round(pred, -3))
            entry["gap_pct"] = round(float(mrow["median_home_value"].iloc[0] / pred - 1), 3)
        towns_out.append(entry)

    result = {
        "generated_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "inputs": {"acs5_maine_towns": {"rows": int(ds.report["raw_rows"]), "sha256": inputs["acs5_maine_towns.csv"]}, "fhfa_hpi": {"sha256": inputs["fhfa_hpi.csv"]}},
        "cleaning": ds.report,
        "regression": {
            "target": "log median home value",
            "best_model": reg.best_name,
            "best_params": reg.best_params,
            "typical_error_pct": round(typical_error, 3),
            "models": reg.table.round(4).to_dict(orient="records"),
            "importance": [{"feature": data.FEATURE_LABELS.get(r.feature, "County"), "importance": round(float(r.importance), 4)} for r in reg.importance.itertuples()],
        },
        "classification": {
            "threshold_dollars": round(cls.threshold_dollars),
            "models": cls.table.round(4).to_dict(orient="records"),
            "logistic_odds_per_sd": [{"feature": data.FEATURE_LABELS[r.feature], "odds_ratio": round(float(r.odds_ratio_per_sd), 2)} for r in cls.logistic_odds.itertuples()],
        },
        "clusters": {
            "k": cl.k,
            "silhouette": round(cl.silhouettes[cl.k], 3),
            "names": {str(k): v for k, v in cl.names.items()},
            "sizes": {str(k): int((cl.towns.cluster == k).sum()) for k in cl.names},
            "pca_explained": [round(v, 3) for v in cl.explained],
        },
        "towns": towns_out,
        "price_index": [
            {
                "geo": o.geo,
                "model": o.best,
                "history": [{"year": int(y), "value": round(float(v), 2)} for y, v in o.history[o.history.index >= 2000].items()],
                "projection": o.projection,
                "backtest_mape": {str(h): round(float(v), 4) for h, v in o.scores.loc[o.best].items()},
            }
            for o in outlooks
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(result, indent=2) + "\n")
    print(f"best regression: {reg.best_name} (typical error ±{typical_error:.0%}); clusters k={cl.k}; wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
