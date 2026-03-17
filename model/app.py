# backend/model/app.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, Any
import pandas as pd
import pickle
import os
from fastapi.middleware.cors import CORSMiddleware

from nutrient_manager import get_or_create_nutrients
from data_generator import check_and_generate_data
from train import train_models
from guidance_data_generator import fetch_and_save_district_data, month_to_num, initialize_guidance_csvs, fetch_and_save_crop_steps
from guidance_train import train_guidance_model


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows requests from your React frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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


class GuidanceRequest(BaseModel):
    district: str
    month: str

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
    
    # 5. Formulate explicit Problems and Solutions
    def evaluate_nutrient(name, diff, req, current):
        if diff < -5:  
            required_nutrients.append({
                "nutrient": name,
                "amount": f"Add {abs(diff):.2f} ppm",
                "recommendedSource": f"Problem: {name} is {abs(diff):.2f} ppm lower than required. Solution: Apply targeted {name.split(' ')[0]} fertilizer to compensate for the historical deficit."
            })
            return "Deficit"
        elif diff > 5:  
            required_nutrients.append({
                "nutrient": name,
                "amount": f"Reduce {diff:.2f} ppm",
                "recommendedSource": f"Problem: {name} is {diff:.2f} ppm higher than required. Solution: Avoid adding {name.split(' ')[0]} based fertilizers. Consider planting a consuming crop."
            })
            return "Surplus"
        return "Stable"

    status_n = evaluate_nutrient("Nitrogen (N)", diff_n, req_n, current_n)
    status_p = evaluate_nutrient("Phosphorus (P)", diff_p, req_p, current_p)
    status_k = evaluate_nutrient("Potassium (K)", diff_k, req_k, current_k)

    final_suitable = ml_is_suitable
    # Force "Not Suitable" if the algorithm detects extreme deficit that ML missed
    if diff_n < -15 or diff_p < -15 or diff_k < -15:
        final_suitable = False

    # 6. Construct Final Response Payload
    return {
        "targetEvaluation": {
            "isSuitable": final_suitable,
            "feedback": [
                f"Nutrient evaluation complete for target: '{req.targetCrop}'.",
                "Review the graphs and historical impact data below to see exact soil changes."
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


@app.post("/recommend_crops")
async def recommend_crops(req: GuidanceRequest):
    initialize_guidance_csvs()
    data_dir = os.path.join(CURRENT_DIR, "data")
    suit_csv = os.path.join(data_dir, "district_suitability.csv")
    steps_csv = os.path.join(data_dir, "cultivation_steps.csv")
    
    df = pd.read_csv(suit_csv)
    
    # 1. AI/Dataset Sync: Check if district & month exists in local dataset
    month_val = month_to_num(req.month)
    data_exists = not df.empty and len(df[(df['District'].str.lower() == req.district.lower()) & (df['Month_Num'] == month_val)]) > 0
    
    if not data_exists:
        success = fetch_and_save_district_data(req.district, req.month)
        if success:
            train_guidance_model()
            df = pd.read_csv(suit_csv)
        else:
            return {"error": "Failed to fetch data from AI."}
            
    # 2. ML Prediction
    try:
        with open(os.path.join(MODEL_DIR, "crop_recommender.pkl"), "rb") as f:
            model = pickle.load(f)
        with open(os.path.join(MODEL_DIR, "district_encoder.pkl"), "rb") as f:
            dist_enc = pickle.load(f)
        with open(os.path.join(MODEL_DIR, "crop_encoder.pkl"), "rb") as f:
            crop_enc = pickle.load(f)
    except FileNotFoundError:
        train_guidance_model()
        return {"error": "Training model for the first time. Please retry in 5 seconds."}

    try:
        encoded_district = dist_enc.transform([req.district])[0]
    except ValueError:
        return {"error": "District not recognized by ML model yet. Try fetching data again."}

    suitable_crops = []
    for crop in crop_enc.classes_:
        encoded_crop = crop_enc.transform([crop])[0]
        prediction = model.predict([[encoded_district, month_val, encoded_crop]])
        if prediction[0] == 1:
            suitable_crops.append(crop)

    # 3. Retrieve Cultivation Steps & Trigger Missing Data AI
    steps_df = pd.read_csv(steps_csv).fillna("")
    recommendations = []
    
    for crop in suitable_crops:
        # Isolate steps just for this crop
        crop_data = steps_df[steps_df['Crop_Name'].str.lower() == crop.lower()]
        crop_steps_raw = crop_data.to_dict('records')
        
        # --- THE MISSING STEPS TRIGGER ---
        if not crop_steps_raw:
            success = fetch_and_save_crop_steps(crop)
            if success:
                steps_df = pd.read_csv(steps_csv).fillna("")
                crop_data = steps_df[steps_df['Crop_Name'].str.lower() == crop.lower()]
                crop_steps_raw = crop_data.to_dict('records')
        
        # --- FIX: Map Python Keys to strictly match React & Mongoose Keys ---
        formatted_steps = []
        for raw in crop_steps_raw:
            formatted_steps.append({
                "stage": str(raw.get("Stage", "")),
                "instructions": str(raw.get("Instructions", "")),
                "estimatedDays": int(raw.get("Estimated_Days", 0)) if raw.get("Estimated_Days") else 0,
                "alert": str(raw.get("Alert", ""))
            })
            
        if formatted_steps:
            recommendations.append({
                "cropName": crop,
                "reasoning": f"Based on historical agricultural data, {crop} is highly suitable for {req.district} in {req.month}.",
                "steps": formatted_steps
            })

    return {"success": True, "data": recommendations}



@app.get("/get_crop_steps/{crop_name}")
async def get_crop_steps(crop_name: str):
    """Dynamically fetches steps for a specific crop for the Tracking Profile."""
    data_dir = os.path.join(CURRENT_DIR, "data")
    steps_csv = os.path.join(data_dir, "cultivation_steps.csv")
    
    try:
        steps_df = pd.read_csv(steps_csv).fillna("")
        # Isolate steps just for this requested crop
        crop_data = steps_df[steps_df['Crop_Name'].str.lower() == crop_name.lower()]
        crop_steps_raw = crop_data.to_dict('records')
        
        formatted_steps = []
        for raw in crop_steps_raw:
            formatted_steps.append({
                "stage": str(raw.get("Stage", "")),
                "instructions": str(raw.get("Instructions", "")),
                "estimatedDays": int(raw.get("Estimated_Days", 0)) if raw.get("Estimated_Days") else 0,
                "alert": str(raw.get("Alert", ""))
            })
            
        return {"success": True, "steps": formatted_steps}
    except Exception as e:
        return {"error": str(e)}