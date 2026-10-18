"""
Market Lab analyst dashboard (internal; not part of the public site).

    cd ml && .venv/bin/streamlit run market_lab/dashboard.py

Explore any of Maine's towns, compare them, and inspect the models behind the website's Market Lab.
Reads the public data in data/gov and the results written by market_lab/build.py.
"""

from __future__ import annotations

import json

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from market_lab import build, clusters, data

st.set_page_config(page_title="Market Lab · Surette Nexus", layout="wide")


@st.cache_data
def load():
    ds = data.load()
    cl = clusters.run(ds.towns)
    lab = json.loads(build.OUT.read_text()) if build.OUT.exists() else None
    return ds, cl, lab


ds, cl, lab = load()
st.title("Market Lab")
st.caption("Census ACS 2020–2024 (all Maine towns) and FHFA price index. Analyst view; the public site shows a summary on /market.")

tab_town, tab_map, tab_models, tab_outlook, tab_data = st.tabs(["Town explorer", "Town map", "Models", "Price outlook", "Data quality"])

with tab_town:
    names = sorted(cl.towns["short_name"].unique())
    town = st.selectbox("Town", names, index=names.index("Waterville") if "Waterville" in names else 0)
    row = cl.towns[cl.towns.short_name == town].iloc[0]
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Median home value", f"${row.median_home_value:,.0f}", help=f"± ${row.median_home_value_moe:,.0f} (90% MOE)")
    c2.metric("Median household income", "—" if pd.isna(row.median_household_income) else f"${row.median_household_income:,.0f}")
    c3.metric("Homeownership", f"{row.owner_rate:.0%}")
    c4.metric("Seasonal / vacant homes", f"{row.vacancy_rate:.0%}")
    st.markdown(f"**Group:** {cl.names[int(row.cluster)]}")
    st.subheader("Most similar towns")
    st.dataframe(pd.DataFrame(clusters.similar_towns(cl, town, 10)), hide_index=True, use_container_width=True)

with tab_map:
    st.markdown(f"Two principal components explain **{sum(cl.explained):.0%}** of the variation between towns. Colour = K-Means group (k = {cl.k}).")
    towns = cl.towns.assign(group=cl.towns.cluster.map(cl.names))
    fig = px.scatter(towns, x="pc1", y="pc2", color="group", hover_name="short_name", hover_data={"county": True, "median_home_value": ":$,.0f", "pc1": False, "pc2": False}, height=600)
    st.plotly_chart(fig, use_container_width=True)
    st.dataframe(cl.loadings.round(2), use_container_width=True)

with tab_models:
    if lab:
        st.subheader("Regression: log median home value (nested cross-validation)")
        st.dataframe(
            pd.DataFrame(lab["regression"]["models"]).style.format({"rmse_log": "{:.3f}", "rmse_log_sd": "{:.3f}", "r2": "{:.3f}", "mae_dollars": "${:,.0f}", "median_abs_pct_error": "{:.1%}"}),
            hide_index=True,
            use_container_width=True,
        )
        imp = pd.DataFrame(lab["regression"]["importance"])
        st.plotly_chart(px.bar(imp, x="importance", y="feature", orientation="h", height=320).update_yaxes(autorange="reversed"), use_container_width=True)
        st.subheader("Classification: above the Maine median home value")
        st.dataframe(pd.DataFrame(lab["classification"]["models"]), hide_index=True, use_container_width=True)
        st.caption("Full experiment history: `mlflow ui --backend-store-uri sqlite:///mlruns/mlflow.db`")
    else:
        st.info("Run `python -m market_lab.build` first.")

with tab_outlook:
    if lab:
        for p in lab["price_index"]:
            hist = pd.DataFrame(p["history"])
            proj = pd.DataFrame(p["projection"])
            last = hist.iloc[-1]
            years = [last.year, *proj.year]
            fig = go.Figure(
                [
                    go.Scatter(x=hist.year, y=hist.value, name="FHFA index", line=dict(color="#15130f")),
                    go.Scatter(
                        x=years + years[::-1],
                        y=[last.value, *proj.high] + [last.value, *proj.low][::-1],
                        fill="toself",
                        fillcolor="rgba(134,96,42,0.2)",
                        line=dict(width=0),
                        name="10th–90th pct of backtest errors",
                    ),
                    go.Scatter(x=years, y=[last.value, *proj.central], name=f"Outlook ({p['model']})", line=dict(dash="dash", color="#86602a")),
                ]
            )
            fig.update_layout(title=p["geo"].title(), height=320, margin=dict(t=40, b=20))
            st.plotly_chart(fig, use_container_width=True)
            st.caption(f"Backtest error: ±{p['backtest_mape']['1']:.1%} (1 year), ±{p['backtest_mape']['2']:.1%} (2 years).")

with tab_data:
    st.json(ds.report)
    st.table(pd.Series(data.CLEANING_RULES, name="rule"))
    miss = ds.model[data.FEATURES].isna().mean().rename("share missing")
    st.bar_chart(miss)
    st.caption(f"Model towns: {len(ds.model)}; log home value mean {np.mean(ds.model[data.TARGET]):.2f}.")
