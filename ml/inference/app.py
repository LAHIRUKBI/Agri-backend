from __future__ import annotations

import json
import math
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI

from ml.inference.feature_builder import build_runtime_features, load_history
from ml.inference.schemas import PredictRequest

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parents[2]
RUN_DIR = BASE_DIR / "model" / "training_runs" / "run_001"
MODEL_PATH = RUN_DIR / "model.pkl"
PRICE_MODEL_PATH = RUN_DIR / "model_price.pkl"
PRICE_FEATURE_COLUMNS_PATH = RUN_DIR / "price_feature_columns.json"
PRICE_METRICS_PATH = RUN_DIR / "price_metrics.json"

model = joblib.load(MODEL_PATH)
history_df = load_history()


def _install_sklearn_pickle_compat():
    try:
        import sklearn.compose._column_transformer as column_transformer
    except Exception as exc:
        print(f"[price_model] sklearn compatibility setup failed: {exc}")
        return

    if not hasattr(column_transformer, "_RemainderColsList"):
        column_transformer._RemainderColsList = type("_RemainderColsList", (list,), {})
        print("[price_model] installed sklearn _RemainderColsList pickle compatibility shim")


def _patch_loaded_sklearn_model(loaded_model):
    try:
        from sklearn.base import BaseEstimator
        from sklearn.impute import SimpleImputer
    except Exception as exc:
        print(f"[price_model] sklearn post-load patch setup failed: {exc}")
        return loaded_model

    def iter_nested_objects(root):
        seen = set()
        stack = [root]

        while stack:
            current = stack.pop()
            current_id = id(current)
            if current_id in seen:
                continue
            seen.add(current_id)
            yield current

            if isinstance(current, dict):
                stack.extend(current.keys())
                stack.extend(current.values())
            elif isinstance(current, (list, tuple, set)):
                stack.extend(current)
            elif isinstance(current, BaseEstimator):
                stack.extend(vars(current).values())

    patched_imputers = 0
    for estimator in iter_nested_objects(loaded_model):
        if isinstance(estimator, SimpleImputer) and not hasattr(estimator, "_fill_dtype"):
            statistics = getattr(estimator, "statistics_", None)
            estimator._fill_dtype = getattr(statistics, "dtype", np.dtype("float64"))
            patched_imputers += 1

    if patched_imputers:
        print(f"[price_model] patched SimpleImputer _fill_dtype count={patched_imputers}")

    return loaded_model


def _load_optional_joblib(path: Path):
    print(f"[price_model] path={path}")
    print(f"[price_model] exists={path.exists()}")

    if not path.exists():
        return None

    try:
        _install_sklearn_pickle_compat()
        return _patch_loaded_sklearn_model(joblib.load(path))
    except Exception as exc:
        print(f"[price_model] load failed: {exc}")
        return None


def _load_optional_json(path: Path):
    if not path.exists():
        return None

    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except Exception:
        return None


PRICE_MODEL = _load_optional_joblib(PRICE_MODEL_PATH)
print(f"[price_model] loaded={PRICE_MODEL is not None}")
price_model = PRICE_MODEL
price_feature_columns = _load_optional_json(PRICE_FEATURE_COLUMNS_PATH) or []
price_metrics = _load_optional_json(PRICE_METRICS_PATH)


def _public_price_metrics():
    if not isinstance(price_metrics, dict):
        return None

    return {
        "mae": price_metrics.get("mae"),
        "rmse": price_metrics.get("rmse"),
        "r2": price_metrics.get("r2"),
        "mape": price_metrics.get("mape"),
    }


def _predict_price(feature_row: dict) -> dict:
    unavailable = {
        "predicted_price_rs_kg": None,
        "price_prediction_source": "unavailable",
        "price_model_metrics": _public_price_metrics(),
    }

    if price_model is None or not price_feature_columns:
        print(
            "[price_model] unavailable: "
            f"loaded={price_model is not None}, "
            f"feature_columns={len(price_feature_columns)}"
        )
        return unavailable

    missing_columns = [
        column for column in price_feature_columns if column not in feature_row
    ]
    if missing_columns:
        print(f"[price_model] unavailable: missing columns={missing_columns}")
        return unavailable

    try:
        price_df = pd.DataFrame([{column: feature_row[column] for column in price_feature_columns}])
        print(f"[price_model] feature_shape={price_df.shape}")
        predicted_price = float(price_model.predict(price_df)[0])
        print(f"[price_model] prediction_output={predicted_price}")
    except Exception as exc:
        print(f"[price_model] prediction failed: {exc}")
        return unavailable

    if not math.isfinite(predicted_price):
        print(f"[price_model] unavailable: non-finite prediction={predicted_price}")
        return unavailable

    return {
        "predicted_price_rs_kg": round(predicted_price, 2),
        "price_prediction_source": "regression_model",
        "price_model_metrics": _public_price_metrics(),
    }


@app.get("/")
def home():
    return {"message": "ML Crop Prediction API Running"}


@app.post("/predict")
def predict(request: PredictRequest):
    payload = request.model_dump()

    payload["crop"] = payload["crop"].strip().lower()
    payload["district"] = payload["district"].strip().lower()
    payload["market"] = payload["market"].strip().lower()

    try:
        feature_row, meta = build_runtime_features(payload, history_df)
        df = pd.DataFrame([feature_row])

        prediction_encoded = model.predict(df)[0]
        probability = model.predict_proba(df)[0].tolist()

        label_map = {0: "DOWN", 1: "UP"}
        classes = [label_map[int(cls)] for cls in model.classes_]

        probability_map = {
            cls_name: prob for cls_name, prob in zip(classes, probability)
        }
        price_prediction = _predict_price(feature_row)

        return {
            "prediction": label_map[int(prediction_encoded)],
            "probabilities": probability_map,
            **price_prediction,
            "source_type": meta.get("source_type"),
            "history_basis": meta.get("history_basis"),
            "is_market_specific": meta.get("is_market_specific"),
            "fallback_used": meta.get("fallback_used"),
            "meta": meta,
        }
    except Exception as e:
        return {
            "error": str(e),
            "received_input": payload
        }
