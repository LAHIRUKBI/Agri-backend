# backend/model/app.py
from fastapi import FastAPI
from pydantic import BaseModel
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

def calculate_total_months(crops: list[CropHistory]):
    months = {'January':1, 'February':2, 'March':3, 'April':4, 'May':5, 'June':6, 
              'July':7, 'August':8, 'September':9, 'October':10, 'November':11, 'December':12}
    total = 0
    for c in crops:
        if c.startMonth in months and c.endMonth in months:
            y_diff = int(c.endYear) - int(c.startYear)
            m_diff = months[c.endMonth] - months[c.startMonth]
            total += (y_diff * 12) + m_diff
    return total if total > 0 else 0

@app.post("/predict")
async def predict_rotation(req: RotationRequest):
    # 1. AI STEP: Fetch specific target requirements from Reference Dataset (or Gemini)
    target_requirements = get_or_create_nutrients(req.targetCrop)
    if not target_requirements:
        return {"error": "Failed to determine crop requirements from dataset."}

    # 2. AI STEP: Ensure we have ML training data for this crop
    new_data_generated = check_and_generate_data(req.targetCrop)

    # 3. SAFETY CHECK: Verify the physical model files exist
    models_exist = os.path.exists(os.path.join(MODEL_DIR, "nutrient_model.pkl")) and \
                   os.path.exists(os.path.join(MODEL_DIR, "suitability_model.pkl"))

    # 4. Force training if models are missing OR new data was just added
    if new_data_generated or not models_exist:
        print("Training triggered: Models are missing or new data was added.")
        success = train_models()
        if not success:
            return {"error": "The AI is currently generating the dataset. Please click Process again in 10 seconds."}

    # 5. Load the trained models
    try:
        with open(os.path.join(MODEL_DIR, "nutrient_model.pkl"), "rb") as f:
            nutrient_model = pickle.load(f)
        with open(os.path.join(MODEL_DIR, "suitability_model.pkl"), "rb") as f:
            suitability_model = pickle.load(f)
    except FileNotFoundError:
        return {"error": "Critical Error: Model files could not be read from the saved_models folder."}

    # 6. Prepare Farmer Data for the Model
    total_months = calculate_total_months(req.previousCrops)
    used_urea = 1 if any("urea" in c.fertilizers.lower() or "යූරියා" in c.fertilizers for c in req.previousCrops) else 0
    used_compost = 1 if any("compost" in c.fertilizers.lower() for c in req.previousCrops) else 0
    
    input_features = pd.DataFrame([[total_months, used_urea, used_compost]], 
                                  columns=["Prev_Months_Farmed", "Used_Urea", "Used_Compost"])

    # 7. Run Predictions
    pred_npk = nutrient_model.predict(input_features)[0]
    pred_n, pred_p, pred_k = pred_npk[0], pred_npk[1], pred_npk[2]
    
    is_suitable = bool(suitability_model.predict(input_features)[0])

    # 8. MATHEMATICAL ANALYSIS
    req_n = float(target_requirements["Min_Nitrogen_ppm"])
    req_p = float(target_requirements["Min_Phosphorus_ppm"])
    req_k = float(target_requirements["Min_Potassium_ppm"])

    diff_n = pred_n - req_n
    diff_p = pred_p - req_p
    diff_k = pred_k - req_k

    # 9. Build the UI Response dynamically
    required_nutrients = []
    
    def analyze_nutrient(name, diff, req, pred):
        if diff < -5:  
            required_nutrients.append({
                "nutrient": name,
                "amount": f"Add {abs(diff):.2f} ppm",
                "recommendedSource": "Fertilizer / Compost"
            })
            return "High Depletion (Lower than required)"
        elif diff > 5:  
            required_nutrients.append({
                "nutrient": name,
                "amount": f"Reduce {diff:.2f} ppm",
                "recommendedSource": "Avoid adding more. Plant consuming crops."
            })
            return "Surplus (Higher than required)"
        return "Stable / Optimal"

    status_n = analyze_nutrient("Nitrogen (N)", diff_n, req_n, pred_n)
    status_p = analyze_nutrient("Phosphorus (P)", diff_p, req_p, pred_p)
    status_k = analyze_nutrient("Potassium (K)", diff_k, req_k, pred_k)

    if diff_n < -15 or diff_p < -15 or diff_k < -15:
        is_suitable = False

    return {
        "targetEvaluation": {
            "isSuitable": is_suitable,
            "feedback": [
                f"Historical analysis: {total_months} months of previous farming.",
                "Nutrient levels mathematically analyzed against crop requirements."
            ]
        },
        "soilCondition": {
            "status": "Imbalanced Nutrients" if len(required_nutrients) > 0 else "Optimal Condition",
            "details": ["Analyzed via Machine Learning algorithm."]
        },
        "alternativeSuggestions": [
            {"cropName": "Legumes", "reasons": ["Improves soil structure automatically."]}
        ] if not is_suitable else [],
        "soilNutrientLevels": [
            {"nutrient": "Nitrogen (N)", "level": f"Predicted: {pred_n:.2f} ppm (Target: {req_n})", "depletionPrediction": status_n},
            {"nutrient": "Phosphorus (P)", "level": f"Predicted: {pred_p:.2f} ppm (Target: {req_p})", "depletionPrediction": status_p},
            {"nutrient": "Potassium (K)", "level": f"Predicted: {pred_k:.2f} ppm (Target: {req_k})", "depletionPrediction": status_k}
        ],
        "requiredNutrients": required_nutrients
    }