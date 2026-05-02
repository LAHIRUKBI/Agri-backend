from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

import pandas as pd
import numpy as np

from ml.inference.feature_builder import (
    RUNTIME_FEATURE_COLUMNS,
    build_features_for_period,
    load_history,
    load_inflation,
    load_weather,
)


PRICE_TARGET_COLUMN = "next_price_rs_kg"
GROUP_COLUMNS = ["crop", "district", "market"]
TIME_COLUMNS = ["year", "month", "week_number"]
REQUIRED_COLUMNS = GROUP_COLUMNS + TIME_COLUMNS + ["price_rs_kg"]


@dataclass
class PriceDatasetResult:
    dataset: pd.DataFrame
    summary: Dict
    skipped_examples: List[Dict]


def normalize_price_data(df: pd.DataFrame) -> pd.DataFrame:
    data = df.copy()

    missing = [column for column in REQUIRED_COLUMNS if column not in data.columns]
    if missing:
        raise ValueError(f"Price dataset missing required columns: {missing}")

    for column in GROUP_COLUMNS:
        data[column] = data[column].astype(str).str.strip().str.lower()

    for column in TIME_COLUMNS + ["price_rs_kg"]:
        data[column] = pd.to_numeric(data[column], errors="coerce")

    data = data.dropna(subset=REQUIRED_COLUMNS).copy()
    data = data.sort_values(by=GROUP_COLUMNS + TIME_COLUMNS).reset_index(drop=True)

    return data


def add_next_price_target(df: pd.DataFrame) -> pd.DataFrame:
    data = normalize_price_data(df)

    grouped = data.groupby(GROUP_COLUMNS, sort=False)
    data[PRICE_TARGET_COLUMN] = grouped["price_rs_kg"].shift(-1)
    data["target_year"] = grouped["year"].shift(-1)
    data["target_month"] = grouped["month"].shift(-1)
    data["target_week_number"] = grouped["week_number"].shift(-1)

    data = data.dropna(
        subset=[PRICE_TARGET_COLUMN, "target_year", "target_month", "target_week_number"]
    ).copy()

    return data


def build_price_training_dataset(df: pd.DataFrame) -> PriceDatasetResult:
    target_rows = add_next_price_target(df)
    history_df = load_history()
    weather_df = load_weather()
    inflation_df = load_inflation()

    records = []
    skipped_examples = []
    skipped_count = 0

    for index, row in target_rows.iterrows():
        payload = {
            "crop": row["crop"],
            "district": row["district"],
            "market": row["market"],
            "price_rs_kg": float(row["price_rs_kg"]),
            "horizon": 1,
        }

        try:
            feature_row, meta = build_features_for_period(
                payload=payload,
                history_df=history_df,
                year=int(row["target_year"]),
                month=int(row["target_month"]),
                week_number=int(row["target_week_number"]),
                weather_df=weather_df,
                inflation_df=inflation_df,
                horizon=1,
            )
        except Exception as exc:
            skipped_count += 1
            if len(skipped_examples) < 10:
                skipped_examples.append(
                    {
                        "row_index": int(index),
                        "crop": row["crop"],
                        "district": row["district"],
                        "market": row["market"],
                        "reason": str(exc),
                    }
                )
            continue

        record = {column: feature_row[column] for column in RUNTIME_FEATURE_COLUMNS}
        record[PRICE_TARGET_COLUMN] = float(row[PRICE_TARGET_COLUMN])
        record["source_year"] = int(row["year"])
        record["source_month"] = int(row["month"])
        record["source_week_number"] = int(row["week_number"])
        record["target_year"] = int(row["target_year"])
        record["target_month"] = int(row["target_month"])
        record["target_week_number"] = int(row["target_week_number"])
        record["history_basis"] = meta.get("history_basis")
        record["source_type"] = meta.get("source_type")
        record["fallback_used"] = bool(meta.get("fallback_used"))
        records.append(record)

    if not records:
        raise ValueError("No regression training rows could be built from the dataset.")

    dataset = pd.DataFrame(records)
    dataset = dataset.replace([np.inf, -np.inf], np.nan)
    dataset = dataset.dropna(subset=[PRICE_TARGET_COLUMN]).copy()

    summary = {
        "source_rows": int(len(df)),
        "target_rows_after_shift": int(len(target_rows)),
        "training_rows_built": int(len(dataset)),
        "rows_skipped": int(skipped_count),
        "target_column": PRICE_TARGET_COLUMN,
        "feature_columns": RUNTIME_FEATURE_COLUMNS,
        "feature_generation": "ml.inference.feature_builder.build_features_for_period",
    }

    return PriceDatasetResult(
        dataset=dataset,
        summary=summary,
        skipped_examples=skipped_examples,
    )
