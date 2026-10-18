"""
Unsupervised view of Maine towns: K-Means groups, a 2-D PCA map, and "towns like this one".

Profile features describe what living there is like (home value, income, rent, ownership, seasonal
homes, ages, size). They're standardized so no single unit dominates; missing values (rent in small
towns) are filled with the median for clustering only. The number of clusters is chosen by silhouette.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
from sklearn.impute import SimpleImputer
from sklearn.metrics import silhouette_score
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

SEED = 42
PROFILE = ["log_home_value", "log_income", "rent_to_income", "owner_rate", "vacancy_rate", "median_age", "housing_age", "log_population"]
LABELS = {
    "log_home_value": ("higher home values", "lower home values"),
    "log_income": ("higher incomes", "lower incomes"),
    "rent_to_income": ("rents high vs incomes", "rents low vs incomes"),
    "owner_rate": ("mostly owners", "more renters"),
    "vacancy_rate": ("many seasonal homes", "few seasonal homes"),
    "median_age": ("older residents", "younger residents"),
    "housing_age": ("older housing", "newer housing"),
    "log_population": ("larger towns", "small towns"),
}


@dataclass
class ClusterResult:
    towns: pd.DataFrame  # + cluster, pc1, pc2
    k: int
    silhouettes: dict[int, float]
    names: dict[int, str]
    profiles: pd.DataFrame  # cluster × feature (z-scores)
    explained: list[float]
    loadings: pd.DataFrame
    neighbors: NearestNeighbors
    Z: np.ndarray


def run(towns: pd.DataFrame, k_range=range(2, 9)) -> ClusterResult:
    df = towns.dropna(subset=["log_home_value"]).reset_index(drop=True)
    X = SimpleImputer(strategy="median").fit_transform(df[PROFILE])
    Z = StandardScaler().fit_transform(X)
    silhouettes = {k: float(silhouette_score(Z, KMeans(k, n_init=20, random_state=SEED).fit_predict(Z))) for k in k_range}
    # Prefer more detail when silhouettes are within 0.02 of the best (they're often nearly tied).
    best = max(silhouettes.values())
    k = max(kk for kk, s in silhouettes.items() if s >= best - 0.02)
    km = KMeans(k, n_init=50, random_state=SEED).fit(Z)
    df["cluster"] = km.labels_
    profiles = pd.DataFrame(km.cluster_centers_, columns=PROFILE)
    names = {}
    for c, row in profiles.iterrows():
        top = row.abs().sort_values(ascending=False).index[:2]
        names[int(c)] = " · ".join(LABELS[f][0] if row[f] > 0 else LABELS[f][1] for f in top).capitalize()
    pca = PCA(2, random_state=SEED).fit(Z)
    pcs = pca.transform(Z)
    df["pc1"], df["pc2"] = pcs[:, 0], pcs[:, 1]
    loadings = pd.DataFrame(pca.components_.T, index=PROFILE, columns=["pc1", "pc2"])
    nn = NearestNeighbors(n_neighbors=6).fit(Z)
    return ClusterResult(df, k, silhouettes, names, profiles, [float(v) for v in pca.explained_variance_ratio_], loadings, nn, Z)


def similar_towns(result: ClusterResult, town: str, n: int = 5) -> list[dict]:
    df = result.towns
    match = df.index[df["short_name"].str.lower() == town.lower()]
    if not len(match):
        return []
    i = int(match[0])
    dist, idx = result.neighbors.kneighbors(result.Z[i : i + 1], n_neighbors=n + 1)
    out = []
    for d, j in zip(dist[0][1:], idx[0][1:], strict=True):
        r = df.iloc[j]
        out.append(
            {
                "town": r["short_name"],
                "county": r["county"],
                "distance": round(float(d), 2),
                "median_home_value": int(r["median_home_value"]),
                "median_household_income": None if pd.isna(r["median_household_income"]) else int(r["median_household_income"]),
            }
        )
    return out
