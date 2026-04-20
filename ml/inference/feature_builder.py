from __future__ import annotations

from pathlib import Path
from typing import Dict, List

import numpy as np
import pandas as pd


BASE_DIR = Path(__file__).resolve().parents[2]
HISTORY_PATH = BASE_DIR / "datasets" / "interim" / "final_dataset.csv"
FEATURE_COLUMNS_PATH = BASE_DIR / "model" / "training_runs" / "run_001" / "feature_columns.json"


def load_history() -> pd.DataFrame:
    df = pd.read_csv(HISTORY_PATH)

    required = ["crop", "district", "market", "season", "year", "month", "week_number", "price_rs_kg"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Historical dataset missing columns: {missing}")

    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df["month"] = pd.to_numeric(df["month"], errors="coerce")
    df["week_number"] = pd.to_numeric(df["week_number"], errors="coerce")
    df["price_rs_kg"] = pd.to_numeric(df["price_rs_kg"], errors="coerce")

    df = df.dropna(subset=["year", "month", "week_number", "price_rs_kg"]).copy()
    return df


def _sort_history(df: pd.DataFrame) -> pd.DataFrame:
    return df.sort_values(by=["crop", "district", "year", "week_number", "market"]).reset_index(drop=True)


def _find_history_subset(
    history_df: pd.DataFrame,
    crop: str,
    district: str,
    market: str | None = None,
) -> pd.DataFrame:
    # Level 1: crop + district + market
    subset_cd = history_df[
        (history_df["crop"].astype(str).str.strip().str.lower() == str(crop).strip().lower()) &
        (history_df["district"].astype(str).str.strip().str.lower() == str(district).strip().lower())
    ].copy()

    if market:
        subset_cdm = subset_cd[
            subset_cd["market"].astype(str).str.strip().str.lower() == str(market).strip().lower()
        ].copy()

        if len(subset_cdm) >= 4:
            return _sort_history(subset_cdm)

    # Level 2: crop + district
    if len(subset_cd) >= 4:
        return _sort_history(subset_cd)

    # Level 3: crop only
    subset_c = history_df[
        history_df["crop"].astype(str).str.strip().str.lower() == str(crop).strip().lower()
    ].copy()

    if len(subset_c) >= 4:
        return _sort_history(subset_c)

    return pd.DataFrame(columns=history_df.columns)


def _take_past_rows(
    subset: pd.DataFrame,
    year: int,
    week_number: int,
    limit: int = 4,
) -> pd.DataFrame:
    past = subset[
        (subset["year"] < year) |
        ((subset["year"] == year) & (subset["week_number"] < week_number))
    ].copy()

    past = past.sort_values(by=["year", "week_number", "market"])
    return past.tail(limit).reset_index(drop=True)


def _safe_std(values: List[float]) -> float:
    if len(values) <= 1:
        return 0.0
    return float(np.std(values, ddof=1))


def _cyclical_month(month: int) -> tuple[float, float]:
    return float(np.sin(2 * np.pi * month / 12)), float(np.cos(2 * np.pi * month / 12))


def _cyclical_week(week_number: int) -> tuple[float, float]:
    return float(np.sin(2 * np.pi * week_number / 52)), float(np.cos(2 * np.pi * week_number / 52))


def build_runtime_features(payload: Dict, history_df: pd.DataFrame) -> Dict:
    crop = payload["crop"]
    district = payload["district"]
    market = payload.get("market")
    season = payload.get("season", "Unknown")
    year = int(payload["year"])
    month = int(payload["month"])
    week_number = int(payload["week_number"])
    price_rs_kg = float(payload["price_rs_kg"])

    subset = _find_history_subset(history_df, crop=crop, district=district, market=market)
    past_rows = _take_past_rows(subset, year=year, week_number=week_number, limit=4)

    if len(past_rows) < 4:
     raise ValueError(
        f"Not enough history to build features. "
        f"crop={crop}, district={district}, market={market}, "
        f"required=4, found={len(past_rows)}. "
        f"Try a crop/district/market combination that exists in the training dataset."
    )

    prices = past_rows["price_rs_kg"].tolist()
    lag_4, lag_3, lag_2, lag_1 = [float(x) for x in prices]

    rolling_mean_2 = float(np.mean([lag_1, lag_2]))
    rolling_mean_4 = float(np.mean([lag_1, lag_2, lag_3, lag_4]))
    rolling_std_4 = _safe_std([lag_1, lag_2, lag_3, lag_4])
    rolling_min_4 = float(min([lag_1, lag_2, lag_3, lag_4]))
    rolling_max_4 = float(max([lag_1, lag_2, lag_3, lag_4]))

    momentum_1 = float(price_rs_kg - lag_1)
    momentum_2 = float(price_rs_kg - lag_2)
    momentum_4 = float(price_rs_kg - lag_4)

    price_vs_mean_4 = float(price_rs_kg / rolling_mean_4) if rolling_mean_4 != 0 else 1.0
    range_4 = float(rolling_max_4 - rolling_min_4)
    volatility_ratio = float(rolling_std_4 / rolling_mean_4) if rolling_mean_4 != 0 else 0.0

    trend_up_1 = int(lag_1 > lag_2)
    trend_up_2 = int(lag_2 > lag_3)
    trend_up_3 = int(lag_3 > lag_4)

    month_sin, month_cos = _cyclical_month(month)
    week_sin, week_cos = _cyclical_week(week_number)

    feature_row = {
        "crop": crop,
        "district": district,
        "market": market if market else "Unknown",
        "season": season,
        "year": year,
        "month": month,
        "week_number": week_number,
        "price_rs_kg": price_rs_kg,
        "lag_1": lag_1,
        "lag_2": lag_2,
        "lag_3": lag_3,
        "lag_4": lag_4,
        "rolling_mean_2": rolling_mean_2,
        "rolling_mean_4": rolling_mean_4,
        "rolling_std_4": rolling_std_4,
        "rolling_min_4": rolling_min_4,
        "rolling_max_4": rolling_max_4,
        "momentum_1": momentum_1,
        "momentum_2": momentum_2,
        "momentum_4": momentum_4,
        "price_vs_mean_4": price_vs_mean_4,
        "range_4": range_4,
        "volatility_ratio": volatility_ratio,
        "trend_up_1": trend_up_1,
        "trend_up_2": trend_up_2,
        "trend_up_3": trend_up_3,
        "month_sin": month_sin,
        "month_cos": month_cos,
        "week_sin": week_sin,
        "week_cos": week_cos,
    }

    return feature_row