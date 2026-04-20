from __future__ import annotations
from pathlib import Path

from fastapi import FastAPI
import joblib
import pandas as pd

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
    payload["season"] = payload["season"].strip()

    try:
        feature_row = build_runtime_features(payload, history_df)
        df = pd.DataFrame([feature_row])

        prediction = model.predict(df)[0]
        probability = model.predict_proba(df)[0].tolist()

        label_map = {0: "DOWN", 1: "UP"}

        return {
            "prediction": label_map[prediction],
            "probabilities": {
                "DOWN": probability[0],
                "UP": probability[1]
            }
        }
    except Exception as e:
        return {
            "error": str(e),
            "received_input": payload
        }