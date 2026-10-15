from __future__ import annotations

from typing import Dict, List

import pandas as pd


REQUIRED_COLUMNS = [
    "price_rs_kg",
    "crop",
    "district",
    "market",
    "week_number",
]


def validate_dataset(df: pd.DataFrame) -> Dict:
    report: Dict = {
        "row_count": int(len(df)),
        "column_count": int(len(df.columns)),
        "columns": list(df.columns),
        "missing_counts": df.isna().sum().to_dict(),
        "duplicate_rows": int(df.duplicated().sum()),
        "required_columns_present": {},
        "numeric_summary": {},
        "warnings": [],
    }

    for col in REQUIRED_COLUMNS:
        report["required_columns_present"][col] = col in df.columns
        if col not in df.columns:
            report["warnings"].append(f"Missing required column: {col}")

    numeric_cols: List[str] = df.select_dtypes(include=["number"]).columns.tolist()
    if numeric_cols:
        report["numeric_summary"] = df[numeric_cols].describe().fillna(0).to_dict()

    if "avg_price" in df.columns:
        if (df["avg_price"] < 0).any():
            report["warnings"].append("Negative values found in avg_price")

    if "nextweek" in df.columns:
        if (df["nextweek"] < 0).any():
            report["warnings"].append("Negative values found in nextweek")

    return report