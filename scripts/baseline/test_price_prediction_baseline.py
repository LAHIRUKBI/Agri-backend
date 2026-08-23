"""Smoke-test and snapshot the current price-prediction behavior.

Run from the repository root with:
    .venv\\Scripts\\python.exe scripts/baseline/test_price_prediction_baseline.py
"""

from __future__ import annotations

import csv
import math
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT))

from ml.inference.app import PRICE_MODEL, predict  # noqa: E402
from ml.inference.schemas import PredictRequest  # noqa: E402


OUTPUT_PATH = REPO_ROOT / "reports" / "baseline" / "price_prediction_baseline.csv"
FIELDNAMES = [
    "crop",
    "district",
    "market",
    "input_price",
    "horizon",
    "predicted_direction",
    "down_probability",
    "up_probability",
    "predicted_price",
    "source_type",
    "fallback_used",
    "history_rows_available",
]

# Each crop/district/market tuple is an exact series in final_dataset.csv.
# The production contract supports only the next market period (horizon=1).
CASES = [
    ("beans", "kandy", "kandy", 424.0, 1),
    ("beans", "dambulla", "dambulla", 394.0, 1),
    ("cabbage", "nuwaraeliya", "nuwaraeliya", 144.0, 1),
    ("carrots", "colombo", "colombo", 141.0, 1),
    ("chili", "kandy", "kandy", 776.0, 1),
    ("eggplants", "meegoda", "meegoda", 364.0, 1),
    ("pumpkin", "dambulla", "dambulla", 180.0, 1),
    ("snake gourd", "nuwaraeliya", "nuwaraeliya", 315.0, 1),
    ("tomatoes", "colombo", "colombo", 368.0, 1),
    ("tomatoes", "meegoda", "meegoda", 382.0, 1),
]


def validate_response(response: dict) -> dict:
    required = {
        "prediction",
        "probabilities",
        "predicted_price_rs_kg",
        "source_type",
        "fallback_used",
        "meta",
    }
    missing = sorted(required - response.keys())
    if missing:
        raise AssertionError(f"required response fields missing: {', '.join(missing)}")
    if "error" in response:
        raise AssertionError(f"prediction returned an error: {response['error']}")

    probabilities = response["probabilities"]
    for label in ("DOWN", "UP"):
        if label not in probabilities:
            raise AssertionError(f"probability field missing: {label}")
    down = float(probabilities["DOWN"])
    up = float(probabilities["UP"])
    if not math.isclose(down + up, 1.0, rel_tol=1e-6, abs_tol=1e-6):
        raise AssertionError(f"probabilities sum to {down + up}, not approximately 1")

    predicted_price = response["predicted_price_rs_kg"]
    if isinstance(predicted_price, bool) or not isinstance(predicted_price, (int, float)):
        raise AssertionError("predicted price is not numeric")
    if not math.isfinite(float(predicted_price)) or predicted_price <= 0:
        raise AssertionError(f"predicted price is not finite and positive: {predicted_price}")

    meta = response["meta"]
    if "history_rows_available" not in meta:
        raise AssertionError("required meta field missing: history_rows_available")
    return {
        "predicted_direction": response["prediction"],
        "down_probability": down,
        "up_probability": up,
        "predicted_price": predicted_price,
        "source_type": response["source_type"],
        "fallback_used": response["fallback_used"],
        "history_rows_available": meta["history_rows_available"],
    }


def main() -> int:
    if PRICE_MODEL is None:
        print("FAIL: price regression model failed to load")
        return 1

    rows = []
    failures = []
    for crop, district, market, input_price, horizon in CASES:
        case = {
            "crop": crop,
            "district": district,
            "market": market,
            "input_price": input_price,
            "horizon": horizon,
        }
        try:
            response = predict(
                PredictRequest(
                    crop=crop,
                    district=district,
                    market=market,
                    current_price_source="manual",
                    price_rs_kg=input_price,
                    horizon=horizon,
                )
            )
            case.update(validate_response(response))
        except Exception as exc:
            failures.append(f"{crop}/{district}/{market}: {exc}")
            case.update({field: "" for field in FIELDNAMES if field not in case})
        rows.append(case)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", newline="", encoding="utf-8") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)

    passed = len(CASES) - len(failures)
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
    print(f"BASELINE {'PASS' if not failures else 'FAIL'}: {passed} passed, {len(failures)} failed")
    print(f"Results: {OUTPUT_PATH}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
