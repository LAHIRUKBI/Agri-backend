from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict
import pandas as pd
import pickle
import os

from nutrient_manager import get_or_create_nutrients
from data_generator import check_and_generate_data
from train import train_models

app = FastAPI()

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")

class CropHistory(BaseModel):
    cropName: str
    startMonth: str
    startYear: str
    endMonth: str
    endYear: str
    fertilizers: str
    pesticides: str

class RotationRequest(BaseModel):
    targetCrop: str
    currentMonth: str
    previousCrops: list[CropHistory]
    language: str
    calculatedNutrients: Dict[str, float]
    historyImpact: Dict[str, float] 
    baselineNutrients: Dict[str, float] 

@app.post("/predict")
async def predict_rotation(req: RotationRequest):
    # 1. Dataset / AI Sync
    target_requirements = get_or_create_nutrients(req.targetCrop)
    if not target_requirements:
        return {"error": "Failed to determine crop requirements from dataset."}

    # 2. Model Training Check
    new_data_generated = check_and_generate_data(req.targetCrop)
    models_exist = os.path.exists(os.path.join(MODEL_DIR, "nutrient_model.pkl")) and \
                   os.path.exists(os.path.join(MODEL_DIR, "suitability_model.pkl"))

    if new_data_generated or not models_exist:
        success = train_models()
        if not success:
            return {"error": "The AI is currently generating the dataset. Please click Process again in 10 seconds."}

    try:
        with open(os.path.join(MODEL_DIR, "nutrient_model.pkl"), "rb") as f:
            nutrient_model = pickle.load(f)
        with open(os.path.join(MODEL_DIR, "suitability_model.pkl"), "rb") as f:
            suitability_model = pickle.load(f)
    except FileNotFoundError:
        return {"error": "Critical Error: Model files missing."}

    # 3. Model Input Extraction
    total_months = len(req.previousCrops) * 3
    used_urea = 1 if any("urea" in c.fertilizers.lower() for c in req.previousCrops) else 0
    used_compost = 1 if any("compost" in c.fertilizers.lower() for c in req.previousCrops) else 0
    
    input_features = pd.DataFrame([[total_months, used_urea, used_compost]], 
                                  columns=["Prev_Months_Farmed", "Used_Urea", "Used_Compost"])

    current_n = req.calculatedNutrients.get('N', 0)
    current_p = req.calculatedNutrients.get('P', 0)
    current_k = req.calculatedNutrients.get('K', 0)

    ml_is_suitable = bool(suitability_model.predict(input_features)[0])

    # 4. Mathematical Comparison
    req_n = float(target_requirements["Min_Nitrogen_ppm"])
    req_p = float(target_requirements["Min_Phosphorus_ppm"])
    req_k = float(target_requirements["Min_Potassium_ppm"])

    diff_n = current_n - req_n
    diff_p = current_p - req_p
    diff_k = current_k - req_k

    required_nutrients = []
    
    def evaluate_nutrient(name, diff, req, current):
        if diff < -5:  
            required_nutrients.append({
                "nutrient": name,
                "amount": f"Add {abs(diff):.2f} ppm",
                "recommendedSource": "Apply targeted fertilizer."
            })
            return "Deficit"
        elif diff > 5:  
            required_nutrients.append({
                "nutrient": name,
                "amount": f"Reduce {diff:.2f} ppm",
                "recommendedSource": "Avoid adding. Plant consuming crops."
            })
            return "Surplus"
        return "Stable"

    status_n = evaluate_nutrient("Nitrogen (N)", diff_n, req_n, current_n)
    status_p = evaluate_nutrient("Phosphorus (P)", diff_p, req_p, current_p)
    status_k = evaluate_nutrient("Potassium (K)", diff_k, req_k, current_k)

    final_suitable = ml_is_suitable
    if diff_n < -15 or diff_p < -15 or diff_k < -15:
        final_suitable = False

    return {
        "targetEvaluation": {
            "isSuitable": final_suitable,
            "feedback": [
                f"Nutrient evaluation complete for target: '{req.targetCrop}'.",
                "Graph shows current levels vs required levels."
            ]
        },
        "baselineNutrients": [
            {"nutrient": "Nitrogen (N)", "level": req.baselineNutrients.get('N', 0)},
            {"nutrient": "Phosphorus (P)", "level": req.baselineNutrients.get('P', 0)},
            {"nutrient": "Potassium (K)", "level": req.baselineNutrients.get('K', 0)}
        ],
        "historyImpact": [
            {"nutrient": "Nitrogen (N)", "change": req.historyImpact.get('N', 0)},
            {"nutrient": "Phosphorus (P)", "change": req.historyImpact.get('P', 0)},
            {"nutrient": "Potassium (K)", "change": req.historyImpact.get('K', 0)}
        ],
        "soilCondition": {
            "status": "Imbalanced Nutrients" if len(required_nutrients) > 0 else "Optimal Condition",
            "details": ["Analyzed via hybrid Algorithm & ML pipeline."]
        },
        "alternativeSuggestions": [
            {"cropName": "Legumes", "reasons": ["Improves soil nitrogen naturally."]},
            {"cropName": "Sweet Potato", "reasons": ["High tolerance to varying soil nutrients."]}
        ] if not final_suitable else [],
        "graphData": [
            {"name": "Nitrogen (N)", "Current": current_n, "Required": req_n},
            {"name": "Phosphorus (P)", "Current": current_p, "Required": req_p},
            {"name": "Potassium (K)", "Current": current_k, "Required": req_k}
        ],
        "soilNutrientLevels": [
            {"nutrient": "Nitrogen (N)", "level": f"{current_n} ppm", "depletionPrediction": status_n},
            {"nutrient": "Phosphorus (P)", "level": f"{current_p} ppm", "depletionPrediction": status_p},
            {"nutrient": "Potassium (K)", "level": f"{current_k} ppm", "depletionPrediction": status_k}
        ],
        "requiredNutrients": required_nutrients
    }