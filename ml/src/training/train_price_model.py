from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from ml.inference.feature_builder import RUNTIME_FEATURE_COLUMNS
from ml.src.features.build_price_target import PRICE_TARGET_COLUMN


@dataclass
class PriceTrainingResult:
    model_pipeline: Pipeline
    X_train: pd.DataFrame
    X_test: pd.DataFrame
    y_train: pd.Series
    y_test: pd.Series
    y_pred: np.ndarray
    metrics: Dict
    feature_columns: List[str]
    numeric_features: List[str]
    categorical_features: List[str]
    feature_importance: pd.DataFrame


def prepare_price_features(df: pd.DataFrame):
    missing_features = [column for column in RUNTIME_FEATURE_COLUMNS if column not in df.columns]
    if missing_features:
        raise ValueError(f"Price training dataset missing runtime feature columns: {missing_features}")

    if PRICE_TARGET_COLUMN not in df.columns:
        raise ValueError(f"Price training dataset missing target column: {PRICE_TARGET_COLUMN}")

    data = df.copy()
    X = data[RUNTIME_FEATURE_COLUMNS].copy()
    y = pd.to_numeric(data[PRICE_TARGET_COLUMN], errors="coerce")

    valid_target_mask = y.notna()
    X = X.loc[valid_target_mask].copy()
    y = y.loc[valid_target_mask].copy()

    numeric_features = X.select_dtypes(include=["number"]).columns.tolist()
    categorical_features = X.select_dtypes(exclude=["number"]).columns.tolist()

    return X, y, numeric_features, categorical_features


def build_price_pipeline(
    numeric_features: List[str],
    categorical_features: List[str],
) -> Pipeline:
    numeric_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])

    categorical_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore")),
    ])

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, numeric_features),
            ("cat", categorical_transformer, categorical_features),
        ]
    )

    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=14,
        min_samples_split=8,
        min_samples_leaf=3,
        random_state=42,
        n_jobs=1,
    )

    return Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("model", model),
    ])


def _period_key(df: pd.DataFrame) -> pd.Series:
    return (
        df["target_year"].astype(int).astype(str)
        + "-"
        + df["target_month"].astype(int).astype(str).str.zfill(2)
        + "-"
        + df["target_week_number"].astype(int).astype(str).str.zfill(2)
    )


def _time_aware_masks(df: pd.DataFrame) -> tuple[pd.Series, pd.Series]:
    period_columns = ["target_year", "target_month", "target_week_number"]
    missing = [column for column in period_columns if column not in df.columns]
    if missing:
        raise ValueError(f"Price training dataset missing split columns: {missing}")

    periods = (
        df[period_columns]
        .drop_duplicates()
        .sort_values(by=period_columns)
        .reset_index(drop=True)
    )

    if len(periods) < 2:
        raise ValueError("Need at least two target periods for a time-aware train/test split.")

    cutoff = int(len(periods) * 0.8)
    cutoff = min(max(cutoff, 1), len(periods) - 1)

    train_periods = periods.iloc[:cutoff].copy()
    train_keys = set(_period_key(train_periods).tolist())
    keys = _period_key(df)

    train_mask = keys.isin(train_keys)
    test_mask = ~train_mask

    if train_mask.sum() == 0 or test_mask.sum() == 0:
        raise ValueError("Time-aware split produced an empty train or test set.")

    return train_mask, test_mask


def _safe_mape(y_true: pd.Series, y_pred: np.ndarray) -> float | None:
    y_true_array = y_true.to_numpy(dtype=float)
    if np.any(np.isclose(y_true_array, 0.0)):
        return None

    return float(np.mean(np.abs((y_true_array - y_pred) / y_true_array)) * 100)


def train_price_random_forest(df: pd.DataFrame) -> PriceTrainingResult:
    X, y, numeric_features, categorical_features = prepare_price_features(df)
    aligned_data = df.loc[X.index].copy()
    train_mask, test_mask = _time_aware_masks(aligned_data)

    X_train = X.loc[train_mask].copy()
    X_test = X.loc[test_mask].copy()
    y_train = y.loc[train_mask].copy()
    y_test = y.loc[test_mask].copy()

    pipeline = build_price_pipeline(numeric_features, categorical_features)
    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    mae = mean_absolute_error(y_test, y_pred)
    mse = mean_squared_error(y_test, y_pred)
    rmse = float(np.sqrt(mse))
    r2 = r2_score(y_test, y_pred)
    mape = _safe_mape(y_test, y_pred)

    target_stats = {
        "min": float(y.min()),
        "max": float(y.max()),
        "mean": float(y.mean()),
        "median": float(y.median()),
        "std": float(y.std()),
    }

    metrics = {
        "mae": float(mae),
        "rmse": rmse,
        "r2": float(r2),
        "mape": mape,
        "train_rows": int(len(X_train)),
        "test_rows": int(len(X_test)),
        "target_column": PRICE_TARGET_COLUMN,
        "target_statistics": target_stats,
        "train_test_split": "time-aware 80/20 by target period",
        "model": "RandomForestRegressor",
    }

    feature_names = pipeline.named_steps["preprocessor"].get_feature_names_out()
    importances = pipeline.named_steps["model"].feature_importances_
    feature_importance = pd.DataFrame({
        "feature": feature_names,
        "importance": importances,
    }).sort_values("importance", ascending=False).reset_index(drop=True)

    return PriceTrainingResult(
        model_pipeline=pipeline,
        X_train=X_train,
        X_test=X_test,
        y_train=y_train,
        y_test=y_test,
        y_pred=y_pred,
        metrics=metrics,
        feature_columns=RUNTIME_FEATURE_COLUMNS,
        numeric_features=numeric_features,
        categorical_features=categorical_features,
        feature_importance=feature_importance,
    )
