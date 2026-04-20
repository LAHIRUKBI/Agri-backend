from __future__ import annotations

from typing import Dict

import numpy as np
import pandas as pd


LABEL_MAP: Dict[str, int] = {
    "DOWN": 0,
    "UP": 1,
}


def create_nextweek_column(df: pd.DataFrame) -> pd.DataFrame:
    data = df.copy()

    data = data.sort_values(
        by=["crop", "district", "market", "year", "week_number"]
    )

    data["nextweek"] = (
        data.groupby(["crop", "district", "market"])["price_rs_kg"]
        .shift(-1)
    )

    return data


def add_basic_features(df: pd.DataFrame) -> pd.DataFrame:
    data = create_nextweek_column(df)

    data = data.dropna(subset=["price_rs_kg", "nextweek"]).copy()

    data["price_change"] = data["nextweek"] - data["price_rs_kg"]

    data["pct_change"] = np.where(
        data["price_rs_kg"] == 0,
        0,
        data["price_change"] / data["price_rs_kg"],
    )

    data["price_ratio"] = np.where(
        data["price_rs_kg"] == 0,
        1.0,
        data["nextweek"] / data["price_rs_kg"],
    )

    return data


def add_time_series_features(df: pd.DataFrame) -> pd.DataFrame:
    data = df.copy()

    data = data.sort_values(
        by=["crop", "district", "market", "year", "week_number"]
    )

    group_cols = ["crop", "district"]

    data["lag_1"] = data.groupby(group_cols)["price_rs_kg"].shift(1)
    data["lag_2"] = data.groupby(group_cols)["price_rs_kg"].shift(2)
    data["lag_3"] = data.groupby(group_cols)["price_rs_kg"].shift(3)
    data["lag_4"] = data.groupby(group_cols)["price_rs_kg"].shift(4)

    data["rolling_mean_2"] = (
        data.groupby(group_cols)["price_rs_kg"]
        .rolling(window=2)
        .mean()
        .reset_index(level=group_cols, drop=True)
    )

    data["rolling_mean_4"] = (
        data.groupby(group_cols)["price_rs_kg"]
        .rolling(window=4)
        .mean()
        .reset_index(level=group_cols, drop=True)
    )

    data["rolling_std_4"] = (
        data.groupby(group_cols)["price_rs_kg"]
        .rolling(window=4)
        .std()
        .reset_index(level=group_cols, drop=True)
    )

    data["rolling_min_4"] = (
        data.groupby(group_cols)["price_rs_kg"]
        .rolling(window=4)
        .min()
        .reset_index(level=group_cols, drop=True)
    )

    data["rolling_max_4"] = (
        data.groupby(group_cols)["price_rs_kg"]
        .rolling(window=4)
        .max()
        .reset_index(level=group_cols, drop=True)
    )

    data["momentum_1"] = data["price_rs_kg"] - data["lag_1"]
    data["momentum_2"] = data["price_rs_kg"] - data["lag_2"]
    data["momentum_4"] = data["price_rs_kg"] - data["lag_4"]

    data["price_vs_mean_4"] = data["price_rs_kg"] / data["rolling_mean_4"]
    data["range_4"] = data["rolling_max_4"] - data["rolling_min_4"]
    data["volatility_ratio"] = data["rolling_std_4"] / data["rolling_mean_4"]

    data["trend_up_1"] = (data["lag_1"] > data["lag_2"]).astype(int)
    data["trend_up_2"] = (data["lag_2"] > data["lag_3"]).astype(int)
    data["trend_up_3"] = (data["lag_3"] > data["lag_4"]).astype(int)

    data["month_sin"] = np.sin(2 * np.pi * data["month"] / 12)
    data["month_cos"] = np.cos(2 * np.pi * data["month"] / 12)
    data["week_sin"] = np.sin(2 * np.pi * data["week_number"] / 52)
    data["week_cos"] = np.cos(2 * np.pi * data["week_number"] / 52)

    data = data.replace([np.inf, -np.inf], np.nan)

    required_cols = ["lag_1", "lag_2", "lag_3", "lag_4"]
    data = data.dropna(subset=required_cols).copy()

    return data


def build_target(df: pd.DataFrame, stable_threshold: float = 0.05) -> pd.DataFrame:
    data = add_basic_features(df)
    data = add_time_series_features(data)

    # Remove STABLE zone completely for binary classification
    data = data[~data["pct_change"].between(-stable_threshold, stable_threshold)].copy()

    conditions = [
        data["pct_change"] < 0,
        data["pct_change"] > 0,
    ]
    labels = ["DOWN", "UP"]

    data["target_label"] = np.select(conditions, labels, default="DOWN")
    data["target"] = data["target_label"].map(LABEL_MAP)

    return data


def winsorize_outliers(
    df: pd.DataFrame,
    columns: list[str],
    lower_q: float = 0.01,
    upper_q: float = 0.99,
) -> pd.DataFrame:
    data = df.copy()
    for col in columns:
        if col in data.columns:
            low = data[col].quantile(lower_q)
            high = data[col].quantile(upper_q)
            data[col] = data[col].clip(lower=low, upper=high)
    return data


def class_distribution(df: pd.DataFrame) -> pd.DataFrame:
    dist = df["target_label"].value_counts().reset_index()
    dist.columns = ["class", "count"]
    dist["percentage"] = dist["count"] / dist["count"].sum() * 100
    return dist


def threshold_experiments(df: pd.DataFrame, thresholds: list[float]) -> pd.DataFrame:
    rows = []

    for t in thresholds:
        temp = add_basic_features(df)
        temp = add_time_series_features(temp)
        temp = temp[~temp["pct_change"].between(-t, t)].copy()

        temp["target_label"] = np.where(temp["pct_change"] < 0, "DOWN", "UP")
        dist = temp["target_label"].value_counts(normalize=True)

        rows.append({
            "threshold": t,
            "DOWN_%": dist.get("DOWN", 0) * 100,
            "UP_%": dist.get("UP", 0) * 100,
            "row_count": len(temp),
        })

    return pd.DataFrame(rows)