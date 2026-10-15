import unittest

from pydantic import ValidationError

from ml.inference import app as inference_app
from ml.inference.feature_builder import (
    build_runtime_features,
    resolve_latest_exact_market_price,
)
from ml.inference.schemas import PredictRequest


class PriceRequestContractTests(unittest.TestCase):
    def test_manual_beans_meegoda_uses_entered_price(self):
        response = inference_app.predict(
            PredictRequest(
                crop="beans",
                district="meegoda",
                market="meegoda",
                current_price_source="manual",
                price_rs_kg=400,
                horizon=1,
            )
        )

        self.assertNotIn("error", response)
        self.assertEqual(response["resolved_current_price_rs_kg"], 400)
        self.assertEqual(response["model_input_price_rs_kg"], 400)
        self.assertEqual(response["persistence_next_price_rs_kg"], 400)
        self.assertEqual(response["model_run_id"], "run_001")
        self.assertEqual(response["model_role"], "experimental_secondary")
        self.assertTrue(response["model_estimate_experimental"])

    def test_system_beans_meegoda_resolves_exact_price(self):
        response = inference_app.predict(
            PredictRequest(
                crop="beans",
                district="meegoda",
                market="meegoda",
                current_price_source="system",
                horizon=1,
            )
        )

        self.assertNotIn("error", response)
        self.assertEqual(response["resolved_current_price_rs_kg"], 448)
        self.assertEqual(response["resolved_current_price_at"], "2024-12-23")
        self.assertEqual(response["model_input_price_rs_kg"], 448)
        self.assertNotEqual(response["model_input_price_rs_kg"], 1)
        self.assertEqual(response["persistence_next_price_rs_kg"], 448)

    def test_system_mode_rejects_supplied_placeholder(self):
        with self.assertRaises(ValidationError):
            PredictRequest(
                crop="beans",
                district="meegoda",
                market="meegoda",
                current_price_source="system",
                price_rs_kg=1,
                horizon=1,
            )

    def test_horizons_two_through_four_are_rejected(self):
        for horizon in (2, 3, 4):
            with self.subTest(horizon=horizon), self.assertRaises(ValidationError):
                PredictRequest(
                    crop="beans",
                    district="meegoda",
                    market="meegoda",
                    current_price_source="manual",
                    price_rs_kg=400,
                    horizon=horizon,
                )

    def test_system_price_resolver_requires_exact_entity(self):
        result = resolve_latest_exact_market_price(
            inference_app.history_df,
            crop="beans",
            district="missing-district",
            market="meegoda",
        )
        self.assertIsNone(result)

    def test_run_001_zero_fill_is_preserved_with_missing_metadata(self):
        features, meta = build_runtime_features(
            {
                "crop": "beans",
                "district": "meegoda",
                "market": "meegoda",
                "price_rs_kg": 400,
                "horizon": 1,
            },
            inference_app.history_df,
        )

        self.assertEqual(features["temp_mean"], 0.0)
        self.assertEqual(features["rainfall_total"], 0.0)
        self.assertEqual(features["inflation_rate"], 0.0)
        self.assertTrue(meta["weather_missing"])
        self.assertTrue(meta["inflation_missing"])
        self.assertEqual(meta["context_quality"], "incomplete")
        self.assertIn("zero-filled", meta["exogenous_compatibility_note"])


if __name__ == "__main__":
    unittest.main()
