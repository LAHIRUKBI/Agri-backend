# backend/model/app.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, Any, List
import pandas as pd
import pickle
import os
import json
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from dotenv import load_dotenv
from sklearn.preprocessing import OneHotEncoder, MultiLabelBinarizer
from sklearn.ensemble import RandomForestClassifier


from nutrient_manager import get_or_create_nutrients
from data_generator import check_and_generate_data
from train import train_models

load_dotenv()
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")
DATA_DIR = os.path.join(CURRENT_DIR, "data")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# Global Variable to hold the model in memory
suitability_model = None

def load_suitability_model():
    global suitability_model
    model_path = os.path.join(MODEL_DIR, "suitability_model.pkl")
    if os.path.exists(model_path):
        try:
            with open(model_path, "rb") as f:
                suitability_model = pickle.load(f)
            print("✅ Suitability ML Model loaded into memory.")
        except Exception as e:
            print(f"❌ Error loading model: {e}")

# Load model on server startup
load_suitability_model()

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
    language: str

def get_ai_soil_remedy(crop_name, n_diff, p_diff, k_diff, language):
    """Gemini හරහා පස සකසා ගැනීමට අවශ්‍ය පිළියම් ලබා දීම"""
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    prompt = f"""
    The farmer wants to plant {crop_name}. Currently, the soil has the following nutrient differences compared to what is required:
    Nitrogen difference: {n_diff:.2f} ppm
    Phosphorus difference: {p_diff:.2f} ppm
    Potassium difference: {k_diff:.2f} ppm
    (Negative values mean a deficit, positive mean a surplus).
    Provide a clear, brief, and practical agricultural recommendation on how to prepare the soil, what fertilizers to add, or what to avoid to fix this soil for the crop. Provide the answer in {language}.
    """
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        return response.text.strip()
    except Exception as e:
        print(f"AI Error: {e}")
        return "Please apply a balanced NPK fertilizer based on standard agricultural guidelines."
    


@app.post("/predict")
async def predict_rotation(req: RotationRequest):
    global suitability_model

    # 1. Get Target Crop Requirements
    target_requirements = get_or_create_nutrients(req.targetCrop)
    if not target_requirements:
        return {"error": "Failed to determine crop requirements from dataset."}

    # 2. Data Generation & Model Training Check
    new_data_generated = check_and_generate_data(req.targetCrop)
    models_exist = os.path.exists(os.path.join(MODEL_DIR, "suitability_model.pkl"))

    if new_data_generated or not models_exist or suitability_model is None:
        success = train_models()
        if not success:
            return {"error": "The AI is currently generating the dataset or preparing the model. Please click Process again in 10 seconds."}
        # Reload model into memory after successful training
        load_suitability_model()

    if suitability_model is None:
        return {"error": "Critical Error: Model could not be loaded into memory."}

    # 3. Process the nutrients
    current_n = float(req.calculatedNutrients.get('N', 0))
    current_p = float(req.calculatedNutrients.get('P', 0))
    current_k = float(req.calculatedNutrients.get('K', 0))

    try:
        req_n = float(target_requirements["Min_Nitrogen_ppm"])
        req_p = float(target_requirements["Min_Phosphorus_ppm"])
        req_k = float(target_requirements["Min_Potassium_ppm"])
    except ValueError:
        return {"error": "Invalid nutrient requirement data retrieved."}

    diff_n = current_n - req_n
    diff_p = current_p - req_p
    diff_k = current_k - req_k

    # ML Model Prediction using the in-memory model
    input_features = pd.DataFrame([[current_n, current_p, current_k, req_n, req_p, req_k]], 
                                  columns=["Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K"])
    
    ml_is_suitable = bool(suitability_model.predict(input_features)[0])

    def evaluate_nutrient(name, diff):
        if diff < -5.0:  
            return "Deficit"
        elif diff > 5.0:  
            return "Surplus"
        return "Stable"

    status_n = evaluate_nutrient("Nitrogen (N)", diff_n)
    status_p = evaluate_nutrient("Phosphorus (P)", diff_p)
    status_k = evaluate_nutrient("Potassium (K)", diff_k)

    # 4. Generating remedies through AI if the soil is not suitable
    ai_remedy_message = ""
    alternative_suggestions = [] # NEW ARRAY
    
    if not ml_is_suitable:
        ai_remedy_message = get_ai_soil_remedy(req.targetCrop, diff_n, diff_p, diff_k, req.language)
        print(f"[AI] Generating alternative crops for {req.targetCrop}...")
        alternative_suggestions = get_ai_alternatives(current_n, current_p, current_k, req.targetCrop, req.language)
    else:
        ai_remedy_message = "Soil is well-suited for this crop! Maintain current nutrient levels with standard agricultural practices."

    # 5. Final Response (Update the return dictionary)
    return {
        "targetEvaluation": {
            "isSuitable": ml_is_suitable,
            "feedback": [
                f"Nutrient evaluation complete for target: '{req.targetCrop}'.",
                "Review the graphs and historical impact data below to see exact soil changes."
            ],
            "aiSoilRemedy": ai_remedy_message
        },
        "soilNutrientLevels": [
            {"nutrient": "Nitrogen (N)", "level": f"{current_n} ppm", "depletionPrediction": status_n, "difference": round(diff_n, 2)},
            {"nutrient": "Phosphorus (P)", "level": f"{current_p} ppm", "depletionPrediction": status_p, "difference": round(diff_p, 2)},
            {"nutrient": "Potassium (K)", "level": f"{current_k} ppm", "depletionPrediction": status_k, "difference": round(diff_k, 2)}
        ],
        "alternativeSuggestions": alternative_suggestions # ADD THIS LINE
    }

def get_ai_alternatives(current_n, current_p, current_k, target_crop, language):
    """Gemini හරහා පවතින පසට ගැලපෙන විකල්ප බෝග 2ක් ලබා ගැනීම"""
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    prompt = f"""
    The farmer's soil currently has the following nutrient levels based on historical data:
    Nitrogen (N): {current_n} ppm
    Phosphorus (P): {current_p} ppm
    Potassium (K): {current_k} ppm

    The requested crop '{target_crop}' is NOT suitable right now.
    Recommend exactly TWO alternative crops that THRIVE in these specific nutrient conditions.
    Explain why they are suitable based specifically on the current N, P, and K levels provided.
    Provide the response in {language}.
    
    Output ONLY a valid JSON array. No markdown, no extra text. Format exactly like this:
    [
      {{
        "cropName": "Alternative Crop 1",
        "reasons": ["Reason 1 based on soil data", "Reason 2"]
      }},
      {{
        "cropName": "Alternative Crop 2",
        "reasons": ["Reason 1 based on soil data", "Reason 2"]
      }}
    ]
    """
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        clean_text = response.text.replace('```json', '').replace('```', '').strip()
        return json.loads(clean_text)
    except Exception as e:
        print(f"Alternative AI Error: {e}")
        return []

    # 5. Final Response
    return {
        "targetEvaluation": {
            "isSuitable": ml_is_suitable,
            "feedback": [
                f"Nutrient evaluation complete for target: '{req.targetCrop}'.",
                "Review the graphs and historical impact data below to see exact soil changes."
            ],
            "aiSoilRemedy": ai_remedy_message
        },
        "soilNutrientLevels": [
            {"nutrient": "Nitrogen (N)", "level": f"{current_n} ppm", "depletionPrediction": status_n, "difference": round(diff_n, 2)},
            {"nutrient": "Phosphorus (P)", "level": f"{current_p} ppm", "depletionPrediction": status_p, "difference": round(diff_p, 2)},
            {"nutrient": "Potassium (K)", "level": f"{current_k} ppm", "depletionPrediction": status_k, "difference": round(diff_k, 2)}
        ]
    }

def train_crop_recommendation_model():
    dataset_path = os.path.join(DATA_DIR, "district_suitability_crops.csv")
    
    if not os.path.exists(dataset_path):
        return False # Skips training if CSV (uses previously trained model)
        
    print(f"\n[ML TRAINING] 🧠 district_suitability_crops.csv මගින් Model එක Training වෙමින් පවතී...")
    
    df = pd.read_csv(dataset_path)
    # Listing of all matching crops by district and month
    grouped = df.groupby(['District', 'Month_Name'])['Crop_Name'].apply(list).reset_index()
    
    # X (Features) - OneHotEncoding
    X_raw = grouped[['District', 'Month_Name']]
    encoder = OneHotEncoder(handle_unknown='ignore')
    X = encoder.fit_transform(X_raw)
    
    # y (Target) - MultiLabelBinarizer (to predict multiple crops at once)
    mlb = MultiLabelBinarizer()
    y = mlb.fit_transform(grouped['Crop_Name'])
    
    # Train Random Forest Model
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X, y)
    
    # Save Models
    with open(os.path.join(MODEL_DIR, "crop_rec_model.pkl"), "wb") as f: pickle.dump(model, f)
    with open(os.path.join(MODEL_DIR, "crop_rec_encoder.pkl"), "wb") as f: pickle.dump(encoder, f)
    with open(os.path.join(MODEL_DIR, "crop_rec_mlb.pkl"), "wb") as f: pickle.dump(mlb, f)
    
    print("[ML TRAINING] ✅ Model එක සාර්ථකව Train කර අවසන්! දැන් dataset එක නොමැතිව predictions ලබා දිය හැක.\n")
    return True

@app.post("/recommend_crops")
async def recommend_crops(req: GuidanceRequest):
    data_dir = os.path.join(CURRENT_DIR, "data")
    suit_csv = os.path.join(data_dir, "district_suitability_crops.csv")
    steps_csv = os.path.join(data_dir, "cultivation_steps.csv")
    
    # 1. Load the new Dataset
    try:
        df = pd.read_csv(suit_csv)
    except FileNotFoundError:
        return {"error": "Dataset district_suitability_crops.csv is missing."}
        
    # 2. Filter dataset for the selected District and Month
    matching_data = df[(df['District'].str.lower() == req.district.lower()) & 
                       (df['Month_Name'].str.lower() == req.month.lower())]
                       
    if matching_data.empty:
         return {"success": False, "message": f"No cultivation data found for {req.district} in {req.month}."}

    # 3. Load static steps dataset
    try:
        steps_df = pd.read_csv(steps_csv).fillna("")
    except FileNotFoundError:
        steps_df = pd.DataFrame()
        
    recommendations = []
    
    # 4. Map Dataset rows to UI response format
    for _, row in matching_data.iterrows():
        crop = row['Crop_Name']
        
        # Merge Reason_1 through Reason_5 safely into a cohesive paragraph
        reasons = []
        for i in range(1, 6):
            val = row.get(f'Reason_{i}')
            if pd.notna(val) and str(val).strip() != "":
                reasons.append(str(val).strip())
        
        reasoning_text = " ".join(reasons) if reasons else f"{crop} is highly suitable for {req.district} during {req.month}."
        
        # 5. Fetch corresponding static steps for the crop
        formatted_steps = []
        if not steps_df.empty and 'Crop_Name' in steps_df.columns:
            crop_data = steps_df[steps_df['Crop_Name'].str.lower() == crop.lower()]
            crop_steps_raw = crop_data.to_dict('records')
            
            for raw in crop_steps_raw:
                raw_days = raw.get("Estimated_Days", 0)
                try:
                    est_days = int(float(raw_days)) if str(raw_days).strip() else 0
                except (ValueError, TypeError):
                    est_days = 0

                formatted_steps.append({
                    "stage": str(raw.get("Stage", "")),
                    "instructions": str(raw.get("Instructions", "")),
                    "estimatedDays": est_days,
                    "alert": str(raw.get("Alert", ""))
                })
                
        recommendations.append({
            "cropName": crop,
            "reasoning": reasoning_text,
            "steps": formatted_steps
        })
        
    return {"success": True, "data": recommendations}



@app.get("/get_crop_steps/{crop_name}")
async def get_crop_steps(crop_name: str, language: str = "English"):
    steps_csv = os.path.join(DATA_DIR, "cultivation_steps.csv")
    
    # 1. Checking if the crop exists in an existing CSV
    if os.path.exists(steps_csv):
        df = pd.read_csv(steps_csv).fillna("")
        crop_data = df[df['Crop_Name'].str.lower() == crop_name.lower()]
        
        if not crop_data.empty:
            print(f"[INFO] '{crop_name}' සඳහා පියවරයන් cultivation_steps.csv මගින් ලබා ගනී.")
            formatted_steps = []
            for raw in crop_data.to_dict('records'):
                try: est_days = int(float(raw.get("Estimated_Days", 0)))
                except: est_days = 0
                formatted_steps.append({
                    "stage": str(raw.get("Stage", "")),
                    "instructions": str(raw.get("Instructions", "")),
                    "estimatedDays": est_days,
                    "alert": str(raw.get("Alert", ""))
                })
            return {"success": True, "steps": formatted_steps}

    # 2. Generating via AI (Gemini) if not in CSV
    print(f"[AI INFO] '{crop_name}' CSV එකෙහි නොමැත. AI මගින් පියවරයන් ජනනය කරමින් පවතී...")
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
    prompt = f"""
    Provide exactly 5 essential cultivation steps for growing '{crop_name}' in {language}.
    Output ONLY a valid JSON array matching this structure exactly (No markdown, no extra text):
    [
      {{ "stage": "Stage Name", "instructions": "Detailed instructions", "estimatedDays": 10, "alert": "Any warning or leave empty" }}
    ]
    """
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        clean_text = response.text.replace('```json', '').replace('```', '').strip()
        ai_steps = json.loads(clean_text)
        
        # 3. Adding the generated steps to cultivation_steps.csv (Save to CSV)
        new_rows = []
        for step in ai_steps:
            new_rows.append({
                "Crop_Name": crop_name,
                "Stage": step.get("stage", ""),
                "Instructions": step.get("instructions", ""),
                "Estimated_Days": step.get("estimatedDays", 0),
                "Alert": step.get("alert", "")
            })
            
        new_df = pd.DataFrame(new_rows)
        # If the file does not exist, it will be created, if it exists, it will be appended.
        if not os.path.exists(steps_csv):
            new_df.to_csv(steps_csv, index=False)
        else:
            new_df.to_csv(steps_csv, mode='a', header=False, index=False)
            
        print(f"[AI INFO] සාර්ථකයි! '{crop_name}' සඳහා නව දත්ත cultivation_steps.csv හි ගබඩා කරන ලදී.")
        return {"success": True, "steps": ai_steps}
        
    except Exception as e:
        print(f"AI Error: {e}")
        return {"success": False, "message": "Failed to generate steps via AI."}