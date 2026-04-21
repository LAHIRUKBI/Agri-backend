from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI

from ml.inference.feature_builder import build_runtime_features, load_history
from ml.inference.schemas import PredictRequest

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parents[2]
MODEL_PATH = BASE_DIR / "model" / "training_runs" / "run_001" / "model.pkl"

model = joblib.load(MODEL_PATH)
history_df = load_history()


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

        return {
            "prediction": label_map[int(prediction_encoded)],
            "probabilities": probability_map,
            "meta": meta,
        }
    except Exception as e:
        return {
            "error": str(e),
            "received_input": payload
        }