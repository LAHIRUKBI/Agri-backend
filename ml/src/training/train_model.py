from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


@dataclass
class TrainingResult:
    model_pipeline: Pipeline
    X_train: pd.DataFrame
    X_test: pd.DataFrame
    y_train: pd.Series
    y_test: pd.Series
    y_pred: pd.Series
    metrics: Dict
    feature_columns: List[str]
    numeric_features: List[str]
    categorical_features: List[str]
    confusion: pd.DataFrame
    feature_importance: pd.DataFrame


def prepare_features(df: pd.DataFrame):
    data = df.copy()

    leakage_cols = [
        "target",
        "target_label",
        "nextweek",
        "price_change",
        "pct_change",
        "price_ratio",
    ]

    # Columns we do NOT want to require at runtime
    drop_runtime_unfriendly = [
        "date",
        "season_encoded",
        "agstat_source_used",
    ]

    # Optional agricultural aggregate columns that may not always be available
    optional_drop_cols = [
        "production_t",
        "yield_t_per_ha",
        "seasonal_yield_t_per_ha",
        "seasonal_extent_ha",
        "extent_ha",
        "annual_yield_t_per_ha",
        "annual_extent_ha",
        "annual_production_t",
        "seasonal_production_t",
    ]

    drop_cols = leakage_cols + drop_runtime_unfriendly + optional_drop_cols
    existing_drop_cols = [c for c in drop_cols if c in data.columns]

    y = data["target"]
    X = data.drop(columns=existing_drop_cols)

    numeric_features = X.select_dtypes(include=["number"]).columns.tolist()
    categorical_features = X.select_dtypes(exclude=["number"]).columns.tolist()

    return X, y, numeric_features, categorical_features


def build_pipeline(
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

    model = RandomForestClassifier(
    n_estimators=150,
    max_depth=10,
    min_samples_split=10,
    min_samples_leaf=5,
    class_weight="balanced",
    random_state=42,
    n_jobs=1,
)

    pipeline = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("model", model),
    ])

    return pipeline


def train_random_forest(df: pd.DataFrame) -> TrainingResult:
    X, y, numeric_features, categorical_features = prepare_features(df)

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.2,
        random_state=42,
        stratify=y,
    )

    pipeline = build_pipeline(numeric_features, categorical_features)
    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)

    cv = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)
    cv_scores = cross_val_score(
        pipeline,
        X,
        y,
        cv=cv,
        scoring="f1_macro",
        n_jobs=1,
        pre_dispatch=1,
)

    metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision_macro": float(precision_score(y_test, y_pred, average="macro", zero_division=0)),
        "recall_macro": float(recall_score(y_test, y_pred, average="macro", zero_division=0)),
        "f1_macro": float(f1_score(y_test, y_pred, average="macro")),
        "cv_f1_macro_mean": float(cv_scores.mean()),
        "cv_f1_macro_std": float(cv_scores.std()),
        "classification_report": classification_report(y_test, y_pred, zero_division=0),
    }

    confusion = pd.DataFrame(
        confusion_matrix(y_test, y_pred),
        index=["true_DOWN", "true_UP"],
        columns=["pred_DOWN", "pred_UP"],
    )

    feature_names = pipeline.named_steps["preprocessor"].get_feature_names_out()
    importances = pipeline.named_steps["model"].feature_importances_
    feature_importance = pd.DataFrame({
        "feature": feature_names,
        "importance": importances,
    }).sort_values("importance", ascending=False).reset_index(drop=True)

    return TrainingResult(
        model_pipeline=pipeline,
        X_train=X_train,
        X_test=X_test,
        y_train=y_train,
        y_test=y_test,
        y_pred=y_pred,
        metrics=metrics,
        feature_columns=X.columns.tolist(),
        numeric_features=numeric_features,
        categorical_features=categorical_features,
        confusion=confusion,
        feature_importance=feature_importance,
    )