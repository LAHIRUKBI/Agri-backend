from __future__ import annotations

from pathlib import Path
import json

import pandas as pd


def write_text(text: str, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def save_metrics_json(metrics: dict, path: str | Path) -> None:
    serializable = dict(metrics)
    if "classification_report" in serializable:
        serializable["classification_report"] = str(serializable["classification_report"])
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(serializable, f, indent=2)


def save_dataframe(df: pd.DataFrame, path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False)