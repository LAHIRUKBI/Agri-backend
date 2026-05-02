from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd


BASE_DIR = Path(__file__).resolve().parents[2]
HISTORY_PATH = BASE_DIR / "datasets" / "interim" / "final_dataset.csv"
FEATURE_COLUMNS_PATH = BASE_DIR / "model" / "training_runs" / "run_001" / "feature_columns.json"
WEATHER_PATH = BASE_DIR / "datasets" / "interim" / "weekly_weather.csv"
INFLATION_PATH = BASE_DIR / "datasets" / "interim" / "weekly_inflation.csv"

RUNTIME_FEATURE_COLUMNS = [
    "year",
    "month",
    "week_number",
    "district",
    "market",
    "crop",
    "price_rs_kg",
    "season",
    "lag_1",
    "lag_2",
    "lag_3",
    "lag_4",
    "rolling_mean_2",
    "rolling_mean_4",
    "rolling_std_4",
    "rolling_min_4",
    "rolling_max_4",
    "momentum_1",
    "momentum_2",
    "momentum_4",
    "price_vs_mean_4",
    "range_4",
    "volatility_ratio",
    "trend_up_1",
    "trend_up_2",
    "trend_up_3",
    "month_sin",
    "month_cos",
    "week_sin",
    "week_cos",
    "temp_mean",
    "rainfall_total",
    "rain_sum",
    "wind_max",
    "inflation_rate",
    "inflation_mom_change",
]


def get_future_date(horizon_weeks: int) -> tuple[int, int, int]:
    today = datetime.today()
    future_date = today + timedelta(weeks=horizon_weeks)

    year = future_date.year
    month = future_date.month
    week_number = future_date.isocalendar()[1]

    return year, month, week_number


def get_season(month: int) -> str:
    if month in [5, 6, 7, 8]:
        return "Yala"
    return "Maha"


def load_history() -> pd.DataFrame:
    df = pd.read_csv(HISTORY_PATH)

    required = ["crop", "district", "market", "season", "year", "month", "week_number", "price_rs_kg"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Historical dataset missing columns: {missing}")

    df["crop"] = df["crop"].astype(str).str.strip().str.lower()
    df["district"] = df["district"].astype(str).str.strip().str.lower()
    df["market"] = df["market"].astype(str).str.strip().str.lower()
    df["season"] = df["season"].astype(str).str.strip()

    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df["month"] = pd.to_numeric(df["month"], errors="coerce")
    df["week_number"] = pd.to_numeric(df["week_number"], errors="coerce")
    df["price_rs_kg"] = pd.to_numeric(df["price_rs_kg"], errors="coerce")

    df = df.dropna(subset=["year", "month", "week_number", "price_rs_kg"]).copy()
    return df


def load_weather() -> pd.DataFrame:
    df = pd.read_csv(WEATHER_PATH)

    required = ["district", "year", "week_number", "temp_mean", "rainfall_total", "rain_sum", "wind_max"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Weekly weather dataset missing columns: {missing}")

    df["district"] = df["district"].astype(str).str.strip().str.lower()
    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df["week_number"] = pd.to_numeric(df["week_number"], errors="coerce")
    df["temp_mean"] = pd.to_numeric(df["temp_mean"], errors="coerce")
    df["rainfall_total"] = pd.to_numeric(df["rainfall_total"], errors="coerce")
    df["rain_sum"] = pd.to_numeric(df["rain_sum"], errors="coerce")
    df["wind_max"] = pd.to_numeric(df["wind_max"], errors="coerce")

    df = df.dropna(subset=["district", "year", "week_number"]).copy()

    df["temp_mean"] = df["temp_mean"].fillna(df["temp_mean"].mean())
    df["rainfall_total"] = df["rainfall_total"].fillna(0)
    df["rain_sum"] = df["rain_sum"].fillna(0)
    df["wind_max"] = df["wind_max"].fillna(df["wind_max"].mean())

    return df


def load_inflation() -> pd.DataFrame:
    df = pd.read_csv(INFLATION_PATH)

    required = ["year", "month", "week_number", "inflation_rate", "inflation_mom_change"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Weekly inflation dataset missing columns: {missing}")

    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df["month"] = pd.to_numeric(df["month"], errors="coerce")
    df["week_number"] = pd.to_numeric(df["week_number"], errors="coerce")
    df["inflation_rate"] = pd.to_numeric(df["inflation_rate"], errors="coerce")
    df["inflation_mom_change"] = pd.to_numeric(df["inflation_mom_change"], errors="coerce")

    df["inflation_rate"] = df["inflation_rate"].fillna(df["inflation_rate"].mean())
    df["inflation_mom_change"] = df["inflation_mom_change"].fillna(0)

    return df


def _sort_history(df: pd.DataFrame) -> pd.DataFrame:
    return df.sort_values(by=["crop", "district", "year", "week_number", "market"]).reset_index(drop=True)


def _find_history_subset(
    history_df: pd.DataFrame,
    crop: str,
    district: str,
    market: str | None = None,
) -> Tuple[pd.DataFrame, Dict]:
    crop = str(crop).strip().lower()
    district = str(district).strip().lower()
    market_norm = str(market).strip().lower() if market else None

    subset_c = history_df[history_df["crop"] == crop].copy()
    subset_cd = history_df[
        (history_df["crop"] == crop) &
        (history_df["district"] == district)
    ].copy()

    market_rows = 0
    if market_norm:
        subset_cdm = subset_cd[subset_cd["market"] == market_norm].copy()
        market_rows = len(subset_cdm)
        if len(subset_cdm) >= 4:
            return _sort_history(subset_cdm), {
                "history_basis": "exact_market",
                "source_type": "exact_market",
                "is_market_specific": True,
                "fallback_used": False,
                "requested_crop": crop,
                "requested_district": district,
                "requested_market": market_norm,
                "history_rows_available": len(subset_cdm),
                "exact_market_rows_available": market_rows,
                "district_rows_available": len(subset_cd),
                "crop_rows_available": len(subset_c),
            }

        subset_cm = history_df[
            (history_df["crop"] == crop) &
            (history_df["market"] == market_norm)
        ].copy()
        if len(subset_cm) >= 4:
            return _sort_history(subset_cm), {
                "history_basis": "market_fallback",
                "source_type": "market_fallback",
                "is_market_specific": True,
                "fallback_used": True,
                "requested_crop": crop,
                "requested_district": district,
                "requested_market": market_norm,
                "history_rows_available": len(subset_cm),
                "exact_market_rows_available": market_rows,
                "district_rows_available": len(subset_cd),
                "crop_rows_available": len(subset_c),
            }

    if len(subset_cd) >= 4:
        return _sort_history(subset_cd), {
            "history_basis": "district_fallback",
            "source_type": "district_fallback",
            "is_market_specific": False,
            "fallback_used": True,
            "requested_crop": crop,
            "requested_district": district,
            "requested_market": market_norm,
            "history_rows_available": len(subset_cd),
            "exact_market_rows_available": market_rows,
            "district_rows_available": len(subset_cd),
            "crop_rows_available": len(subset_c),
        }

    if len(subset_c) >= 4:
        return _sort_history(subset_c), {
            "history_basis": "crop_fallback",
            "source_type": "crop_fallback",
            "is_market_specific": False,
            "fallback_used": True,
            "requested_crop": crop,
            "requested_district": district,
            "requested_market": market_norm,
            "history_rows_available": len(subset_c),
            "exact_market_rows_available": market_rows,
            "district_rows_available": len(subset_cd),
            "crop_rows_available": len(subset_c),
        }

    return pd.DataFrame(columns=history_df.columns), {
        "history_basis": "none",
        "source_type": "none",
        "is_market_specific": False,
        "fallback_used": True,
        "requested_crop": crop,
        "requested_district": district,
        "requested_market": market_norm,
        "history_rows_available": 0,
        "exact_market_rows_available": market_rows,
        "district_rows_available": len(subset_cd),
        "crop_rows_available": len(subset_c),
    }


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


def _latest_market_price(
    history_df: pd.DataFrame,
    crop: str,
    district: str,
    market: str,
) -> Tuple[float | None, str | None]:
    subset_cdm = history_df[
        (history_df["crop"] == crop) &
        (history_df["district"] == district) &
        (history_df["market"] == market)
    ].copy()

    if len(subset_cdm) > 0:
        latest = subset_cdm.sort_values(by=["year", "week_number"]).iloc[-1]
        return float(latest["price_rs_kg"]), "crop_district_market"

    subset_cm = history_df[
        (history_df["crop"] == crop) &
        (history_df["market"] == market)
    ].copy()

    if len(subset_cm) > 0:
        latest = subset_cm.sort_values(by=["year", "week_number", "district"]).iloc[-1]
        return float(latest["price_rs_kg"]), "crop_market"

    return None, None


def _safe_std(values: List[float]) -> float:
    if len(values) <= 1:
        return 0.0
    return float(np.std(values, ddof=1))


def _cyclical_month(month: int) -> tuple[float, float]:
    return float(np.sin(2 * np.pi * month / 12)), float(np.cos(2 * np.pi * month / 12))


def _cyclical_week(week_number: int) -> tuple[float, float]:
    return float(np.sin(2 * np.pi * week_number / 52)), float(np.cos(2 * np.pi * week_number / 52))


def build_features_for_period(
    payload: Dict,
    history_df: pd.DataFrame,
    year: int,
    month: int,
    week_number: int,
    weather_df: pd.DataFrame | None = None,
    inflation_df: pd.DataFrame | None = None,
    horizon: int | None = None,
) -> Tuple[Dict, Dict]:
    crop = str(payload["crop"]).strip().lower()
    district = str(payload["district"]).strip().lower()
    market = str(payload.get("market", "unknown")).strip().lower()
    price_rs_kg = float(payload["price_rs_kg"])
    season = get_season(month)

    subset, history_meta = _find_history_subset(history_df, crop=crop, district=district, market=market)
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
    history_markets = sorted(past_rows["market"].astype(str).str.strip().str.lower().unique().tolist())

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
        "year": year,
        "month": month,
        "week_number": week_number,
        "district": district,
        "market": market,
        "crop": crop,
        "price_rs_kg": price_rs_kg,
        "season": season,
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

    if weather_df is None:
        weather_df = load_weather()

    weather_row = weather_df[
        (weather_df["district"] == district) &
        (weather_df["year"] == year) &
        (weather_df["week_number"] == week_number)
    ]

    if len(weather_row) > 0:
        weather_row = weather_row.iloc[0]
        temp_mean = float(weather_row["temp_mean"])
        rainfall_total = float(weather_row["rainfall_total"])
        rain_sum = float(weather_row["rain_sum"])
        wind_max = float(weather_row["wind_max"])
    else:
        temp_mean = 0.0
        rainfall_total = 0.0
        rain_sum = 0.0
        wind_max = 0.0

    if inflation_df is None:
        inflation_df = load_inflation()

    inflation_row = inflation_df[
        (inflation_df["year"] == year) &
        (inflation_df["month"] == month) &
        (inflation_df["week_number"] == week_number)
    ]

    if len(inflation_row) > 0:
        inflation_row = inflation_row.iloc[0]
        inflation_rate = float(inflation_row["inflation_rate"])
        inflation_mom_change = float(inflation_row["inflation_mom_change"])
    else:
        inflation_rate = 0.0
        inflation_mom_change = 0.0

    feature_row.update({
        "temp_mean": temp_mean,
        "rainfall_total": rainfall_total,
        "rain_sum": rain_sum,
        "wind_max": wind_max,
        "inflation_rate": inflation_rate,
        "inflation_mom_change": inflation_mom_change,
    })
    feature_row = {column: feature_row[column] for column in RUNTIME_FEATURE_COLUMNS}

    latest_market_price, latest_market_price_source = _latest_market_price(
        history_df,
        crop=crop,
        district=district,
        market=market,
    )

    meta = {
        "year": year,
        "month": month,
        "week_number": week_number,
        "season": season,
        "horizon": horizon,
        **history_meta,
        "history_rows_used": len(past_rows),
        "past_rows_used": len(past_rows),
        "history_markets_used": history_markets,
        "latest_history_price_rs_kg": lag_1,
        "latest_market_price_rs_kg": latest_market_price,
        "latest_market_price_source": latest_market_price_source,
        "input_price_rs_kg": price_rs_kg,
    }

    return feature_row, meta


def build_runtime_features(payload: Dict, history_df: pd.DataFrame) -> Tuple[Dict, Dict]:
    horizon = int(payload.get("horizon", 1))
    year, month, week_number = get_future_date(horizon)

    return build_features_for_period(
        payload=payload,
        history_df=history_df,
        year=year,
        month=month,
        week_number=week_number,
        horizon=horizon,
    )
