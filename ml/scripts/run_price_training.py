from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

import joblib

BASE_DIR = Path(__file__).resolve().parents[2]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from ml.src.evaluation.generate_reports import save_dataframe
from ml.src.features.build_price_target import build_price_training_dataset
from ml.src.training.train_price_model import train_price_random_forest
from ml.src.utils.io_utils import ensure_dir, read_csv, save_csv, save_json


INPUT_DATASET = BASE_DIR / "datasets" / "interim" / "final_dataset_with_weather_inflation.csv"
PROCESSED_DIR = BASE_DIR / "datasets" / "processed"
REPORTS_DIR = BASE_DIR / "reports" / "training"
MODEL_ROOT = BASE_DIR / "model" / "training_runs"

RUN_ID = "run_001"
RUN_DIR = MODEL_ROOT / RUN_ID

PRICE_MODEL_PATH = RUN_DIR / "model_price.pkl"
PRICE_FEATURE_COLUMNS_PATH = RUN_DIR / "price_feature_columns.json"
PRICE_METRICS_PATH = RUN_DIR / "price_metrics.json"
PRICE_TRAINING_CONFIG_PATH = RUN_DIR / "price_training_config.json"
PRICE_PROCESSED_DATASET_PATH = PROCESSED_DIR / "price_train_ready_dataset.csv"


def main() -> None:
    ensure_dir(PROCESSED_DIR)
    ensure_dir(REPORTS_DIR)
    ensure_dir(RUN_DIR)

    print(f"[INFO] Reading dataset: {INPUT_DATASET}")
    df = read_csv(INPUT_DATASET)

    print("[INFO] Building price regression training rows with runtime feature logic...")
    dataset_result = build_price_training_dataset(df)
    price_df = dataset_result.dataset
    save_csv(price_df, PRICE_PROCESSED_DATASET_PATH)

    print("[INFO] Training price regression model...")
    result = train_price_random_forest(price_df)

    print("[INFO] Saving separate price model artifacts...")
    joblib.dump(result.model_pipeline, PRICE_MODEL_PATH)
    save_json(result.feature_columns, PRICE_FEATURE_COLUMNS_PATH)
    save_json(result.metrics, PRICE_METRICS_PATH)
    save_json(
        {
            "run_id": RUN_ID,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "input_dataset": str(INPUT_DATASET),
            "processed_dataset": str(PRICE_PROCESSED_DATASET_PATH),
            "target_definition": {
                "target": "next observed price_rs_kg within each crop + district + market group",
                "target_column": "next_price_rs_kg",
                "sort_order": ["crop", "district", "market", "year", "month", "week_number"],
            },
            "feature_generation": dataset_result.summary["feature_generation"],
            "feature_columns_file": str(PRICE_FEATURE_COLUMNS_PATH),
            "metrics_file": str(PRICE_METRICS_PATH),
            "model_file": str(PRICE_MODEL_PATH),
            "classifier_artifacts_untouched": [
                str(RUN_DIR / "model.pkl"),
                str(RUN_DIR / "feature_columns.json"),
                str(RUN_DIR / "metrics.json"),
            ],
            "train_test_split": result.metrics["train_test_split"],
            "model": result.metrics["model"],
            "dataset_summary": dataset_result.summary,
            "skipped_examples": dataset_result.skipped_examples,
            "numeric_features": result.numeric_features,
            "categorical_features": result.categorical_features,
        },
        PRICE_TRAINING_CONFIG_PATH,
    )

    save_dataframe(result.feature_importance, REPORTS_DIR / "price_feature_importance.csv")

    print("[DONE] Price regression training pipeline completed successfully.")
    print(f"[DONE] Processed dataset: {PRICE_PROCESSED_DATASET_PATH}")
    print(f"[DONE] Price model saved to: {PRICE_MODEL_PATH}")
    print(f"[DONE] Price metrics saved to: {PRICE_METRICS_PATH}")


if __name__ == "__main__":
    main()
