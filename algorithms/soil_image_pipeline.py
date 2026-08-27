import json
import os
import pickle
from typing import Dict, Optional
from urllib import parse as urllib_parse
from urllib import request as urllib_request

import pandas as pd


class SoilImagePipeline:
    def __init__(self, model_dir: str, data_dir: str):
        self.model_dir = model_dir
        self.data_dir = data_dir
        self.soil_type_nutrient_model = None
        self.soil_type_nutrient_feature_columns = None
        self.soil_type_nutrient_target_columns = None
        self.soil_type_nutrient_df = None

        self.district_zone_map = {
            "Ampara": "Dry Zone",
            "Anuradhapura": "Dry Zone",
            "Batticaloa": "Dry Zone",
            "Hambantota": "Dry Zone",
            "Monaragala": "Dry Zone",
            "Polonnaruwa": "Dry Zone",
            "Puttalam": "Dry Zone",
            "Trincomalee": "Dry Zone",
            "Badulla": "Intermediate Zone",
            "Kegalle": "Intermediate Zone",
            "Kurunegala": "Intermediate Zone",
            "Matale": "Intermediate Zone",
            "Ratnapura": "Intermediate Zone",
            "Galle": "Wet Zone",
            "Gampaha": "Wet Zone",
            "Kalutara": "Wet Zone",
            "Kandy": "Wet Zone",
            "Matara": "Wet Zone",
            "Nuwara Eliya": "Wet Zone",
            "Colombo": "Urban / Mixed Zone",
            "Jaffna": "Northern Dry Zone",
            "Kilinochchi": "Northern Dry Zone",
            "Mannar": "Northern Dry Zone",
            "Mullaitivu": "Northern Dry Zone",
            "Vavuniya": "Northern Dry Zone",
        }

        self.coastal_districts = {
            "Ampara", "Batticaloa", "Colombo", "Galle", "Gampaha", "Hambantota",
            "Jaffna", "Kalutara", "Mannar", "Matara", "Mullaitivu", "Puttalam", "Trincomalee"
        }

        self.soil_type_profiles = [
            {
                "name": "Reddish Brown Earth",
                "zones": ["Dry Zone", "Intermediate Zone", "Northern Dry Zone"],
                "brightness": 124,
                "texture": 46,
                "redDominance": 24,
                "coastal": False,
            },
            {
                "name": "Red Yellow Podzolic",
                "zones": ["Wet Zone"],
                "brightness": 116,
                "texture": 50,
                "redDominance": 12,
                "coastal": False,
            },
            {
                "name": "Regosol",
                "zones": ["Dry Zone", "Northern Dry Zone"],
                "brightness": 166,
                "texture": 24,
                "redDominance": 3,
                "coastal": True,
            },
            {
                "name": "Alluvial",
                "zones": ["Dry Zone", "Wet Zone", "Intermediate Zone", "Northern Dry Zone", "Urban / Mixed Zone"],
                "brightness": 128,
                "texture": 40,
                "redDominance": 7,
                "coastal": False,
            },
        ]

    def load_soil_type_nutrient_model(self):
        model_path = os.path.join(self.model_dir, "soil_type_nutrient_estimator.pkl")
        if not os.path.exists(model_path):
            print("⚠️ Soil-type nutrient model not found. Roboflow/classification flow will fallback.")
            return False
        try:
            with open(model_path, "rb") as model_file:
                artifact = pickle.load(model_file)
            self.soil_type_nutrient_model = artifact["model"]
            self.soil_type_nutrient_feature_columns = artifact["feature_columns"]
            self.soil_type_nutrient_target_columns = artifact["target_columns"]
            print("✅ Soil-type nutrient estimator loaded.")
            return True
        except Exception as error:
            print(f"⚠️ Failed to load soil-type nutrient estimator: {error}")
            return False

    def load_soil_type_nutrient_dataset(self):
        dataset_path = os.path.join(self.data_dir, "soil_type_nutrient_profiles_cleaned.csv")
        if not os.path.exists(dataset_path):
            print("⚠️ Soil-type nutrient CSV dataset not found.")
            return False
        try:
            self.soil_type_nutrient_df = pd.read_csv(dataset_path).fillna("")
            print(f"✅ Soil-type nutrient CSV loaded. {len(self.soil_type_nutrient_df)} rows.")
            return True
        except Exception as error:
            print(f"⚠️ Failed to load soil-type nutrient CSV: {error}")
            return False

    def classify_soil_image_metrics(self, image_metrics: Dict[str, float]):
        brightness = float(image_metrics.get("brightness", 0.0))
        texture_score = float(image_metrics.get("textureScore", 0.0))
        red_mean = float(image_metrics.get("redMean", 0.0))
        green_mean = float(image_metrics.get("greenMean", 0.0))
        blue_mean = float(image_metrics.get("blueMean", 0.0))
        earthy_ratio = float(image_metrics.get("earthyRatio", 0.0))
        center_earthy_ratio = float(image_metrics.get("centerEarthyRatio", 0.0))
        blue_ratio = float(image_metrics.get("blueRatio", 0.0))
        green_ratio = float(image_metrics.get("greenRatio", 0.0))
        edge_density = float(image_metrics.get("edgeDensity", 0.0))

        channel_spread = max(red_mean, green_mean, blue_mean) - min(red_mean, green_mean, blue_mean)
        strong_soil_signature = (
            earthy_ratio >= 0.26
            and center_earthy_ratio >= 0.30
            and texture_score >= 18
            and edge_density >= 0.07
            and red_mean >= blue_mean - 8
        )
        checks = {
            "earth_dominance": earthy_ratio >= 0.24,
            "soil_centered_frame": center_earthy_ratio >= 0.30,
            "low_blue_scene": blue_ratio <= 0.18,
            "low_green_scene": green_ratio <= 0.22,
            "close_texture": texture_score >= 18 and edge_density >= 0.07,
            "balanced_light": 35 <= brightness <= 205,
            "balanced_channels": channel_spread <= 118 and red_mean >= blue_mean - 8,
        }

        passed_checks = sum(1 for passed in checks.values() if passed)
        confidence = round(passed_checks / len(checks), 2)
        looks_like_wide_scene = (
            (
                (blue_ratio > 0.16 and center_earthy_ratio < 0.24)
                or (green_ratio > 0.20 and center_earthy_ratio < 0.24)
                or center_earthy_ratio < 0.16
                or (texture_score > 55 and blue_mean >= red_mean and earthy_ratio < 0.24)
            )
            and not strong_soil_signature
        )
        is_soil_image = (
            not looks_like_wide_scene
            and (
                strong_soil_signature
                or (
                    passed_checks >= 5
                    and checks["earth_dominance"]
                    and checks["close_texture"]
                    and checks["soil_centered_frame"]
                )
            )
        )

        failed_reasons = []
        if not checks["earth_dominance"]:
            failed_reasons.append("Earth-tone pixel dominance is too low.")
        if not checks["soil_centered_frame"]:
            failed_reasons.append("The center of the image does not look like a close-up soil surface.")
        if not checks["close_texture"]:
            failed_reasons.append("Image does not look like a close-up soil texture.")
        if not checks["low_blue_scene"]:
            failed_reasons.append("Too much sky or water-like blue content detected.")
        if not checks["low_green_scene"]:
            failed_reasons.append("Too much vegetation-like green content detected.")
        if not checks["balanced_light"]:
            failed_reasons.append("Lighting range is not suitable for a soil close-up.")
        if not checks["balanced_channels"]:
            failed_reasons.append("Color balance does not match typical soil imagery.")
        if looks_like_wide_scene:
            failed_reasons.append("Image looks more like a wide scene than a close-up soil photo.")

        return {
            "is_soil_image": is_soil_image,
            "confidence": confidence,
            "label": "soil_close_up" if is_soil_image else "non_soil_or_wide_scene",
            "failed_reasons": failed_reasons,
            "checks": checks,
        }

    def normalize_soil_type(self, raw_soil_type: str):
        normalized = str(raw_soil_type or "").strip().lower().replace("-", " ").replace("_", " ")
        normalized = " ".join(normalized.split())
        mapping = {
            "reddish brown earth": "Reddish Brown Earth",
            "red yellow podzolic": "Red Yellow Podzolic",
            "red yellow podzolic soil": "Red Yellow Podzolic",
            "alluvial": "Alluvial",
            "alluvial soil": "Alluvial",
            "regosol": "Regosol",
            "regosol soil": "Regosol",
            "non soil": "Non_Soil",
            "nonsoil": "Non_Soil",
            "non soil photo": "Non_Soil",
            "non soil image": "Non_Soil",
        }
        return mapping.get(normalized)

    def get_closest_soil_type(self, zone, brightness, texture, red_dominance, coastal):
        best_match = "Alluvial"
        best_score = float("inf")
        for profile in self.soil_type_profiles:
            score = (
                abs(brightness - profile["brightness"]) * 0.9
                + abs(texture - profile["texture"]) * 1.1
                + abs(red_dominance - profile["redDominance"]) * 1.3
            )
            if zone not in profile["zones"]:
                score += 18
            if coastal != profile["coastal"]:
                score += 8
            if score < best_score:
                best_match = profile["name"]
                best_score = score
        return best_match, best_score

    def infer_soil_type_from_image_metrics(self, image_metrics: Dict[str, float], district: str):
        red = float(image_metrics.get("redMean", 0.0))
        green = float(image_metrics.get("greenMean", 0.0))
        blue = float(image_metrics.get("blueMean", 0.0))
        texture = float(image_metrics.get("textureScore", 0.0))
        brightness = float(image_metrics.get("brightness", 0.0))
        earthy_ratio = float(image_metrics.get("earthyRatio", 0.0))
        center_earthy_ratio = float(image_metrics.get("centerEarthyRatio", 0.0))
        zone = self.district_zone_map.get(district, "Mixed Zone")

        red_dominance = red - max(green, blue)
        channel_spread = max(red, green, blue) - min(red, green, blue)
        yellow_bias = red_dominance > 8 and abs(red - green) < 30 and green > blue + 5
        dark_soil = brightness < 92
        bright_soil = brightness > 148
        low_texture = texture < 34
        medium_texture = 34 <= texture < 55
        high_texture = texture >= 55
        coastal = district in self.coastal_districts
        muddy_surface = brightness >= 135 and texture <= 32 and channel_spread <= 35 and earthy_ratio >= 0.2
        looks_like_wide_scene = center_earthy_ratio < 0.2 and texture > 48 and blue >= red - 8

        if looks_like_wide_scene:
            return {
                "soilType": None,
                "confidence": 0.36,
                "supported": False,
                "reason": "wide_scene_non_soil_photo",
                "source": "local_rule",
            }

        if muddy_surface:
            return {
                "soilType": None,
                "confidence": 0.42,
                "supported": False,
                "reason": "muddy_surface_outside_supported_groups",
                "source": "local_rule",
            }

        if zone in {"Dry Zone", "Northern Dry Zone"} and bright_soil and low_texture:
            return {"soilType": "Regosol", "confidence": 0.78, "supported": True, "source": "local_rule"}
        if zone in {"Dry Zone", "Northern Dry Zone"} and 108 <= brightness <= 148 and medium_texture:
            return {"soilType": "Alluvial", "confidence": 0.74, "supported": True, "source": "local_rule"}
        if zone in {"Dry Zone", "Intermediate Zone"} and red_dominance > 18 and red > blue + 25:
            return {"soilType": "Reddish Brown Earth", "confidence": 0.8, "supported": True, "source": "local_rule"}
        if zone == "Wet Zone" and (yellow_bias or (dark_soil and high_texture) or brightness < 132):
            return {"soilType": "Red Yellow Podzolic", "confidence": 0.79, "supported": True, "source": "local_rule"}

        soil_type, distance_score = self.get_closest_soil_type(zone, brightness, texture, red_dominance, coastal)
        confidence = round(max(0.35, min(0.76, 1 - (distance_score / 100))), 2)
        supported = distance_score <= 34
        return {
            "soilType": soil_type,
            "confidence": confidence,
            "supported": supported,
            "distanceScore": round(distance_score, 2),
            "source": "local_fallback",
        }

    def classify_soil_type_via_roboflow(self, image_base64: str):
        api_key = os.getenv("ROBOFLOW_API_KEY", "").strip()
        model_id = os.getenv("ROBOFLOW_MODEL_ID", "").strip()
        if not api_key or not model_id or not image_base64:
            return None

        base64_payload = image_base64.split(",", 1)[1] if "," in image_base64 else image_base64
        endpoint = f"https://classify.roboflow.com/{model_id}?{urllib_parse.urlencode({'api_key': api_key})}"

        try:
            request = urllib_request.Request(
                endpoint,
                data=base64_payload.encode("utf-8"),
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                method="POST",
            )
            with urllib_request.urlopen(request, timeout=25) as response:
                payload = json.loads(response.read().decode("utf-8"))

            predictions = payload.get("predictions")
            top_class = payload.get("top")
            confidence = float(payload.get("confidence", 0.0) or 0.0)
            class_confidences = {}

            predicted_classes = payload.get("predicted_classes") or []
            if not top_class and predicted_classes:
                top_class = predicted_classes[0]

            if isinstance(predictions, list) and predictions:
                for item in predictions:
                    raw_class = item.get("class")
                    normalized_prediction_class = self.normalize_soil_type(raw_class)
                    if normalized_prediction_class:
                        class_confidences[normalized_prediction_class] = float(item.get("confidence", 0.0) or 0.0)
                ranked_predictions = sorted(
                    predictions,
                    key=lambda item: float(item.get("confidence", 0.0) or 0.0),
                    reverse=True,
                )
                best_prediction = ranked_predictions[0]
                top_class = top_class or best_prediction.get("class")
                confidence = max(confidence, float(best_prediction.get("confidence", 0.0) or 0.0))
            elif isinstance(predictions, dict) and top_class:
                for raw_class, details in predictions.items():
                    normalized_prediction_class = self.normalize_soil_type(raw_class)
                    if normalized_prediction_class:
                        class_confidences[normalized_prediction_class] = float(details.get("confidence", 0.0) or 0.0)
                class_prediction = predictions.get(top_class, {})
                confidence = max(confidence, float(class_prediction.get("confidence", 0.0) or 0.0))

            normalized_class = self.normalize_soil_type(top_class)
            supported_soil_classes = [
                "Alluvial",
                "Regosol",
                "Reddish Brown Earth",
                "Red Yellow Podzolic",
            ]
            best_supported_soil = None
            best_supported_confidence = 0.0
            for supported_class in supported_soil_classes:
                supported_confidence = float(class_confidences.get(supported_class, 0.0) or 0.0)
                if supported_confidence > best_supported_confidence:
                    best_supported_soil = supported_class
                    best_supported_confidence = supported_confidence

            if normalized_class:
                if normalized_class == "Non_Soil":
                    non_soil_confidence = float(class_confidences.get("Non_Soil", confidence) or confidence or 0.0)
                    # If a trained soil class is very close to Non_Soil, prefer the soil class.
                    if (
                        best_supported_soil
                        and best_supported_confidence >= 0.32
                        and (non_soil_confidence - best_supported_confidence) <= 0.2
                    ):
                        return {
                            "soilType": best_supported_soil,
                            "rawClass": top_class,
                            "confidence": round(best_supported_confidence, 2),
                            "supported": True,
                            "isSoilImage": True,
                            "reason": "roboflow_supported_soil_close_to_non_soil",
                            "source": "roboflow",
                            "debug": {
                                "topClass": top_class,
                                "classConfidences": {key: round(float(value), 4) for key, value in class_confidences.items()},
                                "bestSupportedSoil": best_supported_soil,
                                "bestSupportedConfidence": round(best_supported_confidence, 4),
                                "nonSoilConfidence": round(non_soil_confidence, 4),
                            },
                        }
                    return {
                        "soilType": "Non_Soil",
                        "rawClass": top_class,
                        "confidence": round(non_soil_confidence, 2),
                        "supported": False,
                        "isSoilImage": False,
                        "reason": "roboflow_non_soil",
                        "source": "roboflow",
                        "debug": {
                            "topClass": top_class,
                            "classConfidences": {key: round(float(value), 4) for key, value in class_confidences.items()},
                            "bestSupportedSoil": best_supported_soil,
                            "bestSupportedConfidence": round(best_supported_confidence, 4),
                            "nonSoilConfidence": round(non_soil_confidence, 4),
                        },
                    }
                return {
                    "soilType": normalized_class,
                    "rawClass": top_class,
                    "confidence": round(confidence, 2),
                    "supported": confidence >= 0.55,
                    "isSoilImage": True,
                    "source": "roboflow",
                    "debug": {
                        "topClass": top_class,
                        "classConfidences": {key: round(float(value), 4) for key, value in class_confidences.items()},
                        "bestSupportedSoil": best_supported_soil,
                        "bestSupportedConfidence": round(best_supported_confidence, 4),
                    },
                }

            if top_class:
                lowered_top = str(top_class).strip().lower().replace("-", " ").replace("_", " ")
                if "non soil" in lowered_top:
                    return {
                        "soilType": "Non_Soil",
                        "rawClass": top_class,
                        "confidence": round(confidence, 2),
                        "supported": False,
                        "isSoilImage": False,
                        "reason": "roboflow_non_soil",
                        "source": "roboflow",
                        "debug": {
                            "topClass": top_class,
                            "classConfidences": {key: round(float(value), 4) for key, value in class_confidences.items()},
                        },
                    }
                return {
                    "soilType": None,
                    "rawClass": top_class,
                    "confidence": round(confidence, 2),
                    "supported": False,
                    "isSoilImage": True,
                    "reason": "roboflow_unmapped_class",
                    "source": "roboflow",
                    "debug": {
                        "topClass": top_class,
                        "classConfidences": {key: round(float(value), 4) for key, value in class_confidences.items()},
                    },
                }
        except Exception as error:
            print(f"⚠️ Roboflow classification failed: {error}")

        return None

    def predict_soil_properties_from_profile(self, soil_type: str, district: str, season: str, crop_type: str):
        if self.soil_type_nutrient_model is None or self.soil_type_nutrient_feature_columns is None:
            if self.soil_type_nutrient_df is None:
                return None

            normalized_crop = str(crop_type or "").strip().lower()
            filters = [
                (self.soil_type_nutrient_df["soil_type"] == soil_type)
                & (self.soil_type_nutrient_df["district"] == district)
                & (self.soil_type_nutrient_df["season"] == (season or "Maha"))
                & (self.soil_type_nutrient_df["crop_type"].astype(str).str.lower() == normalized_crop),
                (self.soil_type_nutrient_df["soil_type"] == soil_type)
                & (self.soil_type_nutrient_df["district"] == district)
                & (self.soil_type_nutrient_df["season"] == (season or "Maha")),
                (self.soil_type_nutrient_df["soil_type"] == soil_type)
                & (self.soil_type_nutrient_df["district"] == district),
                self.soil_type_nutrient_df["soil_type"] == soil_type,
            ]

            matched_rows = None
            for filter_mask in filters:
                subset = self.soil_type_nutrient_df[filter_mask]
                if not subset.empty:
                    matched_rows = subset
                    break

            if matched_rows is None or matched_rows.empty:
                return None

            aggregate = matched_rows[["ph", "nitrogen", "phosphorus", "potassium", "moisture", "organicMatter"]].mean()
            return {
                "ph": round(float(aggregate["ph"]), 2),
                "nitrogen": round(float(aggregate["nitrogen"]), 2),
                "phosphorus": round(float(aggregate["phosphorus"]), 2),
                "potassium": round(float(aggregate["potassium"]), 2),
                "moisture": round(float(aggregate["moisture"]), 2),
                "organicMatter": round(float(aggregate["organicMatter"]), 2),
            }

        feature_df = pd.DataFrame(
            [{
                "soil_type": soil_type,
                "district": district,
                "season": season or "Maha",
                "crop_type": str(crop_type or "").strip().lower(),
            }]
        )
        feature_df = pd.get_dummies(feature_df, columns=["soil_type", "district", "season", "crop_type"])
        feature_df = feature_df.reindex(columns=self.soil_type_nutrient_feature_columns, fill_value=0)

        prediction = self.soil_type_nutrient_model.predict(feature_df)[0]
        return {
            target: round(float(value), 2)
            for target, value in zip(self.soil_type_nutrient_target_columns, prediction)
        }

    def refine_predicted_readings_with_image(self, predicted_readings: Dict[str, float], image_metrics: Dict[str, float]):
        brightness = float(image_metrics.get("brightness", 128.0))
        texture = float(image_metrics.get("textureScore", 40.0))
        red = float(image_metrics.get("redMean", 120.0))
        green = float(image_metrics.get("greenMean", 105.0))
        blue = float(image_metrics.get("blueMean", 90.0))
        earthy_ratio = float(image_metrics.get("earthyRatio", 0.0))
        center_earthy_ratio = float(image_metrics.get("centerEarthyRatio", 0.0))

        channel_spread = max(red, green, blue) - min(red, green, blue)
        muddy_surface = brightness >= 135 and texture <= 32 and channel_spread <= 35 and earthy_ratio >= 0.2
        wet_close_up = brightness <= 125 and texture >= 34 and earthy_ratio >= 0.26 and center_earthy_ratio >= 0.32

        if muddy_surface:
            predicted_readings["moisture"] = round(max(float(predicted_readings.get("moisture", 0.0)), 32.0), 2)
            predicted_readings["organicMatter"] = round(max(float(predicted_readings.get("organicMatter", 0.0)), 3.2), 2)
        elif wet_close_up:
            predicted_readings["moisture"] = round(max(float(predicted_readings.get("moisture", 0.0)), 26.0), 2)
        elif brightness < 110 and texture >= 45:
            predicted_readings["moisture"] = round(max(float(predicted_readings.get("moisture", 0.0)), 24.0), 2)

        return predicted_readings
