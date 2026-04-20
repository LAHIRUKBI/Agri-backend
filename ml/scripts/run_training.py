from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import joblib
import pandas as pd

from ml.src.data.validate_data import validate_dataset
from ml.src.evaluation.generate_reports import save_dataframe, save_metrics_json, write_text
from ml.src.features.build_target import build_target, class_distribution, threshold_experiments, winsorize_outliers
from ml.src.training.train_model import train_random_forest
from ml.src.utils.io_utils import ensure_dir, read_csv, save_csv, save_json


BASE_DIR = Path(__file__).resolve().parents[2]
INPUT_DATASET = BASE_DIR / "datasets" / "interim" / "final_dataset_with_weather.csv"
PROCESSED_DIR = BASE_DIR / "datasets" / "processed"
REPORTS_DIR = BASE_DIR / "reports" / "training"
MODEL_ROOT = BASE_DIR / "model" / "training_runs"

RUN_ID = "run_001"
RUN_DIR = MODEL_ROOT / RUN_ID


def main() -> None:
    ensure_dir(PROCESSED_DIR)
    ensure_dir(REPORTS_DIR)
    ensure_dir(RUN_DIR)

    print(f"[INFO] Reading dataset: {INPUT_DATASET}")
    df = read_csv(INPUT_DATASET)

    print("[INFO] Validating dataset...")
    audit_report = validate_dataset(df)
    save_json(audit_report, REPORTS_DIR / "data_quality_report.json")

    print("[INFO] Running threshold experiments...")
    threshold_df = threshold_experiments(df, thresholds=[0.02, 0.03, 0.05, 0.07, 0.10])
    save_dataframe(threshold_df, REPORTS_DIR / "threshold_experiments.csv")

    # Default chosen threshold
    stable_threshold = 0.05

    print(f"[INFO] Building target with stable threshold = {stable_threshold}")
    df = build_target(df, stable_threshold=stable_threshold)

    # Outlier handling only for numeric price-derived features
    df = winsorize_outliers(
        df,
        columns=["avg_price", "nextweek", "price_change", "abs_price_change", "price_ratio_next_to_current"],
        lower_q=0.01,
        upper_q=0.99,
    )

    # Drop obvious leakage columns that directly expose future value
    if "nextweek" in df.columns:
        df = df.drop(columns=["nextweek"])

    save_csv(df, PROCESSED_DIR / "train_ready_dataset.csv")

    print("[INFO] Saving class distribution...")
    dist_df = class_distribution(df)
    save_dataframe(dist_df, REPORTS_DIR / "class_distribution.csv")

    print("[INFO] Training model...")
    result = train_random_forest(df)

    print("[INFO] Saving model artifacts...")
    joblib.dump(result.model_pipeline, RUN_DIR / "model.pkl")
    joblib.dump(result.model_pipeline.named_steps["preprocessor"], RUN_DIR / "preprocessing.pkl")

    save_json(result.feature_columns, RUN_DIR / "feature_columns.json")
    save_json({"DOWN": 0, "UP": 1}, RUN_DIR / "label_mapping.json")
    save_metrics_json(result.metrics, RUN_DIR / "metrics.json")
    save_json(
        {
            "run_id": RUN_ID,
            "input_dataset": str(INPUT_DATASET),
            "processed_dataset": str(PROCESSED_DIR / "train_ready_dataset.csv"),
            "stable_threshold": stable_threshold,
            "target_definition": {
                "DOWN": "pct_change < -stable_threshold",
                "STABLE": "-stable_threshold <= pct_change <= stable_threshold",
                "UP": "pct_change > stable_threshold",
            },
            "train_test_split": "80/20 stratified",
            "model": "RandomForestClassifier",
        },
        RUN_DIR / "training_config.json",
    )

    print("[INFO] Saving reports...")
    write_text(result.metrics["classification_report"], REPORTS_DIR / "classification_report.txt")
    save_dataframe(result.confusion.reset_index(), REPORTS_DIR / "confusion_matrix.csv")
    save_dataframe(result.feature_importance, REPORTS_DIR / "feature_importance.csv")

    print("[DONE] Training pipeline completed successfully.")
    print(f"[DONE] Processed dataset: {PROCESSED_DIR / 'train_ready_dataset.csv'}")
    print(f"[DONE] Model saved to: {RUN_DIR / 'model.pkl'}")
    print(f"[DONE] Metrics saved to: {RUN_DIR / 'metrics.json'}")


if __name__ == "__main__":
    main()