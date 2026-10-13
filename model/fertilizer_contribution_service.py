"""
Drop-in helper for backend/model/app.py.

The model predicts fertilizer-derived N/P/K contribution in g/sq.ft.
IoT sensor readings remain current soil readings (usually ppm) and are kept
separate. Do not add g/sq.ft to ppm.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import joblib

SQ_FT_PER_ACRE = 43560.0
MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}


def _get(obj: Any, key: str, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def duration_months(crop: Any) -> int:
    try:
        start_month = MONTHS[str(_get(crop, "startMonth", "")).strip().lower()]
        end_month = MONTHS[str(_get(crop, "endMonth", "")).strip().lower()]
        start_year = int(_get(crop, "startYear"))
        end_year = int(_get(crop, "endYear"))
        return max(1, (end_year - start_year) * 12 + end_month - start_month)
    except (KeyError, TypeError, ValueError):
        return 3


def _composition_row(agro_df: pd.DataFrame, product_name: str):
    if agro_df is None or agro_df.empty or product_name not in agro_df.index:
        return None
    row = agro_df.loc[product_name]
    if isinstance(row, pd.DataFrame):
        row = row.iloc[0]
    try:
        values = [float(row["N"]), float(row["P"]), float(row["K"])]
        if not all(math.isfinite(v) and v >= 0 for v in values):
            return None
        return values
    except (KeyError, TypeError, ValueError):
        return None


def _amount_per_sqft(crop: Any, amount_g: Any) -> float:
    try:
        amount = float(amount_g)
        land_acres = float(_get(crop, "landSize", 0))
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(amount) or amount <= 0 or not math.isfinite(land_acres) or land_acres <= 0:
        return 0.0
    return amount / (land_acres * SQ_FT_PER_ACRE)


def build_history_features(previous_crops, feature_names, agro_df):
    """
    Build exactly the training feature order:
      [total_months, fertilizer::<product1>, fertilizer::<product2>, ...]
    Land size is interpreted as acres, consistent with the supplied training notebook.
    Pesticides are excluded because the training notebook only used fertilizers.
    """
    density_by_product = {name.split("::", 1)[1]: 0.0 for name in feature_names if name.startswith("fertilizer::")}
    total_months = 0
    chemical_breakdown = []
    warnings = []

    for crop in previous_crops or []:
        total_months += duration_months(crop)
        fertilizers = _get(crop, "fertilizers", []) or []
        for chem in fertilizers:
            name = str(_get(chem, "name", "")).strip()
            amount_g = _get(chem, "amount_g", 0)
            density = _amount_per_sqft(crop, amount_g)
            if density <= 0:
                warnings.append(f"Skipped invalid amount/land size for fertilizer '{name}'.")
                continue

            composition = _composition_row(agro_df, name)
            if composition is None:
                warnings.append(f"No N-P-K composition found for '{name}'; it was not included.")
                continue

            # Only features known to the trained model can be sent to it.
            if name in density_by_product:
                density_by_product[name] += density
            else:
                warnings.append(f"Fertilizer '{name}' is not in the model's training feature list.")

            n100, p100, k100 = composition
            multiplier = float(amount_g) / 100.0
            chemical_breakdown.append({
                "name": name,
                "amount_g": float(amount_g),
                "land_sqft": float(_get(crop, "landSize", 0)) * SQ_FT_PER_ACRE,
                "base_100g": {"N": n100, "P": p100, "K": k100},
                "added_g_per_sqft": {
                    "N": n100 * multiplier / (float(_get(crop, "landSize", 0)) * SQ_FT_PER_ACRE),
                    "P": p100 * multiplier / (float(_get(crop, "landSize", 0)) * SQ_FT_PER_ACRE),
                    "K": k100 * multiplier / (float(_get(crop, "landSize", 0)) * SQ_FT_PER_ACRE),
                },
            })

    values = []
    for feature in feature_names:
        if feature == "total_months":
            values.append(float(total_months))
        elif feature.startswith("fertilizer::"):
            values.append(float(density_by_product.get(feature.split("::", 1)[1], 0.0)))
        else:
            raise ValueError(f"Unsupported feature in metadata: {feature}")
    return np.asarray([values], dtype=float), chemical_breakdown, warnings


def load_contribution_model(model_dir):
    model_dir = Path(model_dir)
    model_path = model_dir / "fertilizer_contribution_model.pkl"
    scaler_path = model_dir / "fertilizer_contribution_scaler.pkl"
    metadata_path = model_dir / "fertilizer_contribution_features.json"
    if not (model_path.exists() and scaler_path.exists() and metadata_path.exists()):
        return None, None, None
    model = joblib.load(model_path)
    scaler = joblib.load(scaler_path)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    feature_names = metadata.get("feature_names", [])
    if not feature_names or getattr(model, "n_features_in_", None) != len(feature_names):
        raise ValueError("Saved contribution model and feature metadata do not match.")
    if getattr(scaler, "n_features_in_", None) != len(feature_names):
        raise ValueError("Saved contribution scaler and feature metadata do not match.")
    return model, scaler, feature_names


def calculate_fertilizer_contribution(previous_crops, agro_df, model=None, scaler=None, feature_names=None):
    """
    Return exact composition-based nutrient mass per sq.ft as the primary result.
    The Random Forest estimate is included separately for comparison because its
    targets were generated from this same formula; it must not be treated as a
    measurement of nutrients retained by the soil.
    """
    if not feature_names:
        product_names = []
        if agro_df is not None and not agro_df.empty:
            product_names = [str(name) for name in agro_df.index.tolist()]
        feature_names = [f"fertilizer::{name}" for name in product_names]

    X, breakdown, warnings = build_history_features(previous_crops, feature_names, agro_df)

    exact_totals = {"N": 0.0, "P": 0.0, "K": 0.0}
    for item in breakdown:
        for key in exact_totals:
            exact_totals[key] += float(item["added_g_per_sqft"][key])

    model_estimate = None
    if model is not None and scaler is not None:
        try:
            prediction = np.asarray(model.predict(scaler.transform(X))[0], dtype=float).reshape(-1)
            if prediction.size != 3 or not np.isfinite(prediction).all():
                raise ValueError("Model returned invalid N-P-K contribution values.")
            prediction = np.maximum(prediction, 0.0)
            model_estimate = {
                "N_g_per_sqft": float(prediction[0]),
                "P_g_per_sqft": float(prediction[1]),
                "K_g_per_sqft": float(prediction[2]),
                "unit": "g/sq.ft",
                "note": "Random Forest estimate from synthetic training targets; not a soil measurement.",
            }
        except Exception as exc:
            warnings.append(f"Model prediction failed; direct composition calculation is used ({exc}).")

    return {
        "added_n_g_per_sqft": exact_totals["N"],
        "added_p_g_per_sqft": exact_totals["P"],
        "added_k_g_per_sqft": exact_totals["K"],
        "unit": "g/sq.ft",
        "source": "composition_based_calculation",
        "model_estimate": model_estimate,
        "chemical_breakdown": breakdown,
        "warnings": warnings,
    }
