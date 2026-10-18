"""
Generate and execute the Market Lab notebooks (outputs are saved so they read as reports on GitHub).

    cd ml && .venv/bin/python notebooks/build_notebooks.py
"""

from __future__ import annotations

from pathlib import Path

import nbformat as nbf
from nbclient import NotebookClient

HERE = Path(__file__).resolve().parent


def md(text: str):
    return nbf.v4.new_markdown_cell(text.strip())


def code(text: str):
    return nbf.v4.new_code_cell(text.strip())


EDA = [
    md("""
# Maine towns — exploratory data analysis

Data: U.S. Census Bureau, American Community Survey 2020–2024 5-year estimates for every Maine county
subdivision (`data/gov/acs5_maine_towns.csv`, downloaded by `market_lab/acs_towns.py` with checksums),
plus the FHFA house price index and BLS unemployment already used by the website.

Questions: What do Maine towns look like? What is related to home values? What cleaning does the data need?
"""),
    code("""
import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd, matplotlib.pyplot as plt, seaborn as sns
import plotly.express as px, plotly.io as pio
pio.renderers.default = "notebook_connected"   # loads plotly.js from a CDN instead of embedding 3 MB
sns.set_theme(style="whitegrid")
import sys; sys.path.insert(0, "..")
from market_lab import data

raw = data.load_raw()
raw.shape, raw.columns.tolist()
"""),
    md("## 1. Raw data quality\nCensus marks unavailable estimates with large negative codes. Count them per column before cleaning."),
    code("""
numeric = raw.columns.difference(["geo_id", "town", "county"])
(raw[numeric] < 0).sum().sort_values(ascending=False).to_frame("census 'not available' codes")
"""),
    code("""
ds = data.load()
pd.Series(ds.report).to_frame("count")
"""),
    md("Cleaning rules applied (from `market_lab/data.py`):"),
    code("""
pd.Series(data.CLEANING_RULES).to_frame("rule")
"""),
    md("## 2. Missing values after cleaning\nMedian rent is the column most often unpublished (small towns). Models impute it inside cross-validation."),
    code("""
missing = ds.model[data.FEATURES].isna().mean().sort_values(ascending=False)
ax = missing.plot.barh(figsize=(6, 3), color="#86602a"); ax.set_xlabel("share missing"); plt.tight_layout()
"""),
    md("## 3. Distributions\nHome values are right-skewed, so models predict the log."),
    code("""
fig, axes = plt.subplots(1, 2, figsize=(10, 3.5))
sns.histplot(ds.model["median_home_value"] / 1000, bins=40, ax=axes[0], color="#86602a"); axes[0].set_xlabel("Median home value ($k)")
sns.histplot(ds.model["log_home_value"], bins=40, ax=axes[1], color="#1f3a32"); axes[1].set_xlabel("log(median home value)")
plt.tight_layout()
"""),
    code("""
ds.model[data.FEATURES + ["median_home_value"]].describe().T.round(3)
"""),
    md("## 4. Relationships\nCorrelation (Spearman: rank-based, robust to skew) between the engineered features and the target."),
    code("""
corr = ds.model[data.FEATURES + [data.TARGET]].corr(method="spearman")
plt.figure(figsize=(7, 5.5)); sns.heatmap(corr, annot=True, fmt=".2f", cmap="vlag", center=0, square=True, cbar=False); plt.tight_layout()
"""),
    md("Income is the strongest single correlate. The seasonal-home share (vacancy) matters in Maine: ski and lake towns have high values with many homes empty most of the year."),
    code("""
fig = px.scatter(ds.model, x="median_household_income", y="median_home_value", color="vacancy_rate", hover_name="short_name",
                 hover_data=["county", "population"], log_x=True, log_y=True, color_continuous_scale="Viridis",
                 labels={"median_household_income": "Median household income", "median_home_value": "Median home value", "vacancy_rate": "Seasonal/vacant share"},
                 title="Maine towns: income vs home value (interactive)")
fig.update_layout(height=480); fig
"""),
    code("""
top = ds.towns.dropna(subset=["median_home_value"]).nlargest(8, "vacancy_rate")[["short_name", "county", "vacancy_rate", "median_home_value", "population"]]
top.style.format({"vacancy_rate": "{:.0%}", "median_home_value": "${:,.0f}", "population": "{:,.0f}"})
"""),
    md("## 5. Our towns in context"),
    code("""
ours = ["Waterville", "Augusta", "Winslow", "Oakland", "Sidney", "Belgrade", "Fairfield"]
view = ds.towns[ds.towns.short_name.isin(ours)].set_index("short_name")
view["home value percentile (Maine towns)"] = view["median_home_value"].apply(lambda v: (ds.towns["median_home_value"] < v).mean())
view[["county", "median_home_value", "median_household_income", "owner_rate", "home value percentile (Maine towns)"]].style.format(
    {"median_home_value": "${:,.0f}", "median_household_income": "${:,.0f}", "owner_rate": "{:.0%}", "home value percentile (Maine towns)": "{:.0%}"})
"""),
    md("## 6. Prices over time (FHFA) and the labour market (BLS)"),
    code("""
hpi = data.load_hpi()
growth = np.log(hpi).diff() * 100
fig, axes = plt.subplots(1, 2, figsize=(11, 3.6))
hpi[hpi.index >= 1990].plot(ax=axes[0]); axes[0].set_ylabel("FHFA index (2000 = 100)")
growth[growth.index >= 1990].plot(ax=axes[1]); axes[1].axhline(0, color="grey", lw=0.8); axes[1].set_ylabel("annual change (%)")
plt.tight_layout()
growth.tail(6).round(1)
"""),
    code("""
bls = pd.read_csv(data.DATA / "bls_laus.csv", parse_dates=["period"])
bls["area"] = bls["series_id"].str.split(":").str[-1]
wide = bls.pivot(index="period", columns="area", values="value")
ax = wide.plot(figsize=(10, 3.4)); ax.set_ylabel("unemployment rate (%)"); ax.set_xlabel("")
# Average by calendar month, leaving out 2020–21 (the COVID spike would dominate April–May).
# The statewide series (LASST…) is seasonally adjusted by BLS, so it's flat by design; the county
# and U.S. series are not adjusted and show the seasonal pattern.
normal = wide[~wide.index.year.isin([2020, 2021])]
normal.groupby(normal.index.month).mean().round(2).T
"""),
    md("""
## Findings

- **Income explains most of the difference in home values between towns**; county (region) and the share of seasonal homes come next.
- **Seasonal-home towns are a distinct group**: very high "vacancy" with high values (ski and lake towns).
- **Data quality**: 53 tiny places dropped, 19 towns excluded from models (no published value or too uncertain), rent missing for ~23% of model towns — imputed inside cross-validation only.
- **Prices**: the FHFA index more than doubled from 2015 to 2025 (×2.1 Kennebec, ×2.2 Somerset); growth slowed after the 2021–22 peak (16–17% a year), though Somerset rose 9% in 2025.
- **County unemployment is seasonal**: outside 2020–21, Somerset averages ~5.6% in January vs ~3.5% in September, so compare the same month across years. (The statewide series is seasonally adjusted by BLS, so it doesn't show this.)

Next: `02_models.ipynb` (supervised models, clustering, forecasting).
"""),
]

MODELS = [
    md("""
# Market Lab — models

Supervised learning, unsupervised learning and forecasting on the cleaned data from `01_eda.ipynb`.
Everything here is computed by the same code the website's results come from (`market_lab/*.py`),
and every run is also recorded in MLflow (`mlflow ui --backend-store-uri sqlite:///mlruns/mlflow.db`).
"""),
    code("""
import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd, matplotlib.pyplot as plt, seaborn as sns
sns.set_theme(style="whitegrid")
import sys; sys.path.insert(0, "..")
from market_lab import data, models, clusters, forecast
ds = data.load()
len(ds.model), data.FEATURES
"""),
    md("""
## 1. Regression: what explains a town's median home value?

Pipeline per model: impute (median + missing indicators) → standardize → model, all inside cross-validation.
Tunable models use **nested cross-validation** (inner grid search, outer 5-fold), so scores aren't optimistic.
"""),
    code("""
reg = models.run_regression(ds.model)
reg.table.style.format({"rmse_log": "{:.3f}", "rmse_log_sd": "{:.3f}", "r2": "{:.3f}", "mae_dollars": "${:,.0f}", "median_abs_pct_error": "{:.1%}"})
"""),
    md("Regularized linear models win: with ~450 towns and smooth relationships, trees and SVMs add variance without adding accuracy. The tuned hyper-parameters of the chosen model:"),
    code("""
reg.best_name, reg.best_params
"""),
    code("""
imp = reg.importance.assign(feature=lambda d: d.feature.map(lambda f: data.FEATURE_LABELS.get(f, "County")))
ax = imp.plot.barh(x="feature", y="importance", xerr="sd", legend=False, figsize=(6, 3.5), color="#86602a")
ax.invert_yaxis(); ax.set_xlabel("permutation importance (increase in RMSE)"); plt.tight_layout()
"""),
    md("Out-of-fold predictions (each town predicted by a model that never saw it):"),
    code("""
m = ds.model.assign(predicted=np.exp(reg.oof))
ax = sns.scatterplot(data=m, x="predicted", y="median_home_value", s=18)
lim = [m[["predicted", "median_home_value"]].min().min(), m[["predicted", "median_home_value"]].max().max()]
ax.plot(lim, lim, color="grey", lw=1); ax.set(xscale="log", yscale="log", xlabel="predicted", ylabel="actual"); plt.tight_layout()
"""),
    md("## 2. Classification: is a town above the Maine median?\nLogistic regression gives interpretable effects (odds ratio per standard deviation)."),
    code("""
cls = models.run_classification(ds.model)
display(cls.table.style.format({"accuracy": "{:.3f}", "f1": "{:.3f}", "roc_auc": "{:.3f}", "roc_auc_sd": "{:.3f}"}))
cls.logistic_odds.assign(feature=lambda d: d.feature.map(data.FEATURE_LABELS)).round(2)
"""),
    md("## 3. Unsupervised: K-Means groups and a PCA map"),
    code("""
cl = clusters.run(ds.towns)
pd.Series(cl.silhouettes, name="silhouette").to_frame().T.round(3)
"""),
    code("""
display(pd.DataFrame({"name": cl.names, "towns": cl.towns.cluster.value_counts().sort_index()}))
cl.profiles.round(2).rename(index=cl.names)
"""),
    code("""
fig, ax = plt.subplots(figsize=(7, 5))
for c, name in cl.names.items():
    sel = cl.towns[cl.towns.cluster == c]; ax.scatter(sel.pc1, sel.pc2, s=12, label=name)
ax.set(xlabel=f"PC1 ({cl.explained[0]:.0%})", ylabel=f"PC2 ({cl.explained[1]:.0%})"); ax.legend(fontsize=8); plt.tight_layout()
cl.loadings.round(2)
"""),
    md('Silhouette scores are low (~0.18): Maine towns form a continuum, so the groups are summaries rather than hard categories. Nearest neighbours are more useful for "towns like this one":'),
    code("""
{t: [s["town"] for s in clusters.similar_towns(cl, t)] for t in ["Waterville", "Oakland", "Sidney"]}
"""),
    md("## 4. Forecasting the price index (rolling-origin backtest)"),
    code("""
hpi = data.load_hpi()
outlooks = {g: forecast.outlook(hpi[g], g) for g in ["maine", "kennebec", "somerset"]}
pd.concat({g: (o.scores * 100).round(1) for g, o in outlooks.items()}, names=["area"]).rename(columns={1: "1-yr MAPE %", 2: "2-yr MAPE %"})
"""),
    code("""
pd.DataFrame([{"area": g, "model": o.best, **p} for g, o in outlooks.items() for p in o.projection])
"""),
    md("""
## Conclusions

- A tuned **ridge regression** predicts a town's median home value within about ±15% (median error), explaining ~65% of the variation.
- Random forests and SVMs don't beat it here; the extra flexibility isn't supported by ~450 data points.
- Classification above/below the median reaches ROC-AUC ≈ 0.93 (random forest ≈ logistic regression).
- Price-index forecasts: simple autoregressive models backtest at ~2.5–3.5% error one year ahead; uncertainty roughly doubles two years out.
"""),
]


def build(name: str, cells) -> None:
    nb = nbf.v4.new_notebook(cells=cells, metadata={"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}})
    NotebookClient(nb, timeout=900, kernel_name="python3", resources={"metadata": {"path": str(HERE)}}).execute()
    nbf.write(nb, HERE / name)
    print(f"executed {name}")


if __name__ == "__main__":
    build("01_eda.ipynb", EDA)
    build("02_models.ipynb", MODELS)
