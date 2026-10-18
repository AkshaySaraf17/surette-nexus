"""
Supervised models on Maine towns: what explains a town's median home value?

Regression target: log(median home value). Classification target: is the town's median home value above
the median of all modelled towns? Both use the same engineered features (data.FEATURES) plus county.

Method (no leakage, honest error estimates):
  - Each model is a scikit-learn Pipeline: impute (median, + missing-value indicators) → scale → model,
    fitted inside every cross-validation fold.
  - Tunable models are tuned with an inner GridSearchCV and scored with an outer K-fold
    (nested cross-validation), so the reported error isn't optimistic.
  - "Value vs fundamentals" uses out-of-fold predictions: each town is predicted by a model that never
    saw it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LinearRegression, LogisticRegression, Ridge
from sklearn.metrics import mean_absolute_error, r2_score, roc_auc_score
from sklearn.model_selection import GridSearchCV, KFold, StratifiedKFold, cross_val_predict, cross_validate
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.svm import SVC, SVR
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor

from .data import FEATURES, TARGET

SEED = 42


def preprocessor() -> ColumnTransformer:
    numeric = Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)), ("scale", StandardScaler())])
    county = OneHotEncoder(handle_unknown="ignore", min_frequency=5)
    return ColumnTransformer([("num", numeric, FEATURES), ("county", county, ["county"])])


def pipe(model) -> Pipeline:
    return Pipeline([("prep", preprocessor()), ("model", model)])


# name → (estimator, hyper-parameter grid or None)
REGRESSORS = {
    "Baseline (mean)": (DummyRegressor(), None),
    "Linear regression": (LinearRegression(), None),
    "Ridge regression": (Ridge(), {"model__alpha": [0.1, 1, 10, 30]}),
    "Decision tree": (DecisionTreeRegressor(random_state=SEED), {"model__max_depth": [3, 4, 6, 8], "model__min_samples_leaf": [5, 10, 20]}),
    "Random forest": (
        RandomForestRegressor(random_state=SEED, n_jobs=-1),
        {"model__n_estimators": [300], "model__max_depth": [None, 8], "model__min_samples_leaf": [1, 3, 5], "model__max_features": [0.5, 1.0]},
    ),
    "SVM (RBF kernel)": (SVR(), {"model__C": [0.3, 1, 3, 10], "model__gamma": ["scale", 0.03, 0.1], "model__epsilon": [0.05, 0.1]}),
}

CLASSIFIERS = {
    "Baseline (majority)": (DummyClassifier(strategy="most_frequent"), None),
    "Logistic regression": (LogisticRegression(max_iter=2000), {"model__C": [0.1, 1, 10]}),
    "Decision tree": (DecisionTreeClassifier(random_state=SEED), {"model__max_depth": [3, 4, 6], "model__min_samples_leaf": [5, 10, 20]}),
    "Random forest": (RandomForestClassifier(random_state=SEED, n_jobs=-1), {"model__n_estimators": [300], "model__max_depth": [None, 8], "model__min_samples_leaf": [1, 3, 5]}),
    "SVM (RBF kernel)": (SVC(probability=True, random_state=SEED), {"model__C": [0.3, 1, 3, 10], "model__gamma": ["scale", 0.03, 0.1]}),
}


def tuned(estimator, grid, cv, scoring):
    model = pipe(estimator)
    return GridSearchCV(model, grid, cv=cv, scoring=scoring, n_jobs=-1) if grid else model


@dataclass
class RegressionResult:
    table: pd.DataFrame  # one row per model: nested-CV metrics
    best_name: str
    best_params: dict
    oof: pd.Series  # out-of-fold predictions of the best model (log value)
    importance: pd.DataFrame
    final: Pipeline


def run_regression(df: pd.DataFrame) -> RegressionResult:
    X, y = df[FEATURES + ["county"]], df[TARGET]
    outer, inner = KFold(5, shuffle=True, random_state=SEED), KFold(4, shuffle=True, random_state=SEED + 1)
    rows = []
    for name, (est, grid) in REGRESSORS.items():
        cv = cross_validate(tuned(est, grid, inner, "neg_root_mean_squared_error"), X, y, cv=outer, scoring=("neg_root_mean_squared_error", "r2"), n_jobs=1)
        pred = cross_val_predict(tuned(est, grid, inner, "neg_root_mean_squared_error"), X, y, cv=outer)
        # Error in dollars: back-transform both sides from log.
        mae_dollars = mean_absolute_error(np.exp(y), np.exp(pred))
        mape = float(np.median(np.abs(np.exp(pred) / np.exp(y) - 1)))
        rows.append(
            {
                "model": name,
                "rmse_log": -cv["test_neg_root_mean_squared_error"].mean(),
                "rmse_log_sd": cv["test_neg_root_mean_squared_error"].std(),
                "r2": cv["test_r2"].mean(),
                "mae_dollars": mae_dollars,
                "median_abs_pct_error": mape,
            }
        )
    table = pd.DataFrame(rows).sort_values("rmse_log").reset_index(drop=True)
    best_name = table.loc[table["model"] != "Baseline (mean)", "model"].iloc[0]
    est, grid = REGRESSORS[best_name]
    search = tuned(est, grid, KFold(5, shuffle=True, random_state=SEED), "neg_root_mean_squared_error")
    search.fit(X, y)
    final = search.best_estimator_ if grid else search
    best_params = {k.replace("model__", ""): v for k, v in (search.best_params_ if grid else {}).items()}
    oof = pd.Series(cross_val_predict(clone(final), X, y, cv=KFold(5, shuffle=True, random_state=SEED)), index=df.index)
    imp = permutation_importance(final, X, y, n_repeats=20, random_state=SEED, scoring="neg_root_mean_squared_error")
    importance = pd.DataFrame({"feature": X.columns, "importance": imp.importances_mean, "sd": imp.importances_std}).sort_values("importance", ascending=False)
    return RegressionResult(table, best_name, best_params, oof, importance.reset_index(drop=True), final)


@dataclass
class ClassificationResult:
    table: pd.DataFrame
    threshold_dollars: float
    logistic_odds: pd.DataFrame  # interpretable effects from logistic regression


def run_classification(df: pd.DataFrame) -> ClassificationResult:
    threshold = float(np.exp(df[TARGET].median()))
    X, y = df[FEATURES + ["county"]], (df[TARGET] > df[TARGET].median()).astype(int)
    outer, inner = StratifiedKFold(5, shuffle=True, random_state=SEED), StratifiedKFold(4, shuffle=True, random_state=SEED + 1)
    rows = []
    for name, (est, grid) in CLASSIFIERS.items():
        cv = cross_validate(tuned(est, grid, inner, "roc_auc"), X, y, cv=outer, scoring=("accuracy", "f1", "roc_auc"), n_jobs=1)
        rows.append({"model": name, "accuracy": cv["test_accuracy"].mean(), "f1": cv["test_f1"].mean(), "roc_auc": cv["test_roc_auc"].mean(), "roc_auc_sd": cv["test_roc_auc"].std()})
    table = pd.DataFrame(rows).sort_values("roc_auc", ascending=False).reset_index(drop=True)
    # Logistic regression on standardized numeric features only: odds ratio per 1 standard deviation.
    numeric = Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler()), ("model", LogisticRegression(max_iter=2000))])
    numeric.fit(df[FEATURES], y)
    coefs = numeric.named_steps["model"].coef_[0]
    odds = pd.DataFrame({"feature": FEATURES, "odds_ratio_per_sd": np.exp(coefs)}).sort_values("odds_ratio_per_sd", ascending=False)
    return ClassificationResult(table, threshold, odds.reset_index(drop=True))


def auc(y_true, scores) -> float:
    return float(roc_auc_score(y_true, scores))


def r2(y_true, y_pred) -> float:
    return float(r2_score(y_true, y_pred))
