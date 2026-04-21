# backend/model/app.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Dict, List
import pandas as pd
import pickle
import os
import json
import numpy as np
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from dotenv import load_dotenv
from sklearn.preprocessing import OneHotEncoder, MultiLabelBinarizer
from sklearn.ensemble import RandomForestClassifier

from nutrient_manager import get_or_create_nutrients   # only for crop NPK requirements

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

# ---------- Global ML models ----------
npk_model = None
npk_scaler = None
chem_dict = None               # loaded once at startup
crop_rec_model = None
crop_rec_encoder = None
crop_rec_mlb = None

# ---------- Load NPK Predictor Model ----------
def load_npk_predictor():
    global npk_model, npk_scaler
    model_path = os.path.join(MODEL_DIR, "npk_predictor_model.pkl")
    scaler_path = os.path.join(MODEL_DIR, "npk_predictor_scaler.pkl")
    if os.path.exists(model_path) and os.path.exists(scaler_path):
        with open(model_path, "rb") as f:
            npk_model = pickle.load(f)
        with open(scaler_path, "rb") as f:
            npk_scaler = pickle.load(f)
        print("✅ NPK predictor model loaded.")
        return True
    else:
        print("⚠️ NPK predictor model not found. Falling back to deterministic calculation.")
        return False

# ---------- Load Agrochemical Data (once) ----------
def load_agrochemical_data():
    global chem_dict
    dict_path = os.path.join(MODEL_DIR, "chemical_composition.pkl")
    if os.path.exists(dict_path):
        with open(dict_path, "rb") as f:
            chem_dict = pickle.load(f)
        print(f"✅ Agrochemical composition dictionary loaded. {len(chem_dict)} products.")
        return True
    else:
        print("⚠️ Chemical composition dictionary missing.")
        return False

# ---------- Load Crop Recommendation Models ----------
def load_crop_rec_models():
    global crop_rec_model, crop_rec_encoder, crop_rec_mlb
    try:
        with open(os.path.join(MODEL_DIR, "crop_rec_model.pkl"), "rb") as f:
            crop_rec_model = pickle.load(f)
        with open(os.path.join(MODEL_DIR, "crop_rec_encoder.pkl"), "rb") as f:
            crop_rec_encoder = pickle.load(f)
        with open(os.path.join(MODEL_DIR, "crop_rec_mlb.pkl"), "rb") as f:
            crop_rec_mlb = pickle.load(f)
        print("✅ Crop Recommendation ML Models loaded into memory.")
        return True
    except Exception as e:
        return False

def train_crop_recommendation_model():
    """Train from CSV if exists, otherwise skip."""
    dataset_path = os.path.join(DATA_DIR, "district_suitability_crops.csv")
    if not os.path.exists(dataset_path):
        return False
    print(f"\n[ML TRAINING] 🧠 Training crop recommendation model...")
    df = pd.read_csv(dataset_path)
    grouped = df.groupby(['District', 'Month_Name'])['Crop_Name'].apply(list).reset_index()
    X_raw = grouped[['District', 'Month_Name']]
    encoder = OneHotEncoder(handle_unknown='ignore')
    X = encoder.fit_transform(X_raw)
    mlb = MultiLabelBinarizer()
    y = mlb.fit_transform(grouped['Crop_Name'])
    model = RandomForestClassifier(n_estimators=100, random_state=42)
    model.fit(X, y)
    with open(os.path.join(MODEL_DIR, "crop_rec_model.pkl"), "wb") as f: pickle.dump(model, f)
    with open(os.path.join(MODEL_DIR, "crop_rec_encoder.pkl"), "wb") as f: pickle.dump(encoder, f)
    with open(os.path.join(MODEL_DIR, "crop_rec_mlb.pkl"), "wb") as f: pickle.dump(mlb, f)
    print("[ML TRAINING] ✅ Crop recommendation model trained.")
    return True

# ---------- Deterministic Fallback NPK Calculation ----------
def calculate_current_npk(baseline, past_crops):
    global npk_model, npk_scaler, chem_dict
    
    if npk_model is None or npk_scaler is None or chem_dict is None:
        print("[WARN] ML model or dictionary missing.")
        return 0, 0, 0, []
    
    total_n_added = 0.0
    total_p_added = 0.0
    total_k_added = 0.0
    total_months = 0
    chemical_breakdown = [] 
    
    months_map = {'January':1, 'February':2, 'March':3, 'April':4, 'May':5, 'June':6,
                  'July':7, 'August':8, 'September':9, 'October':10, 'November':11, 'December':12}
    
    for crop in past_crops:
        try:
            duration = (int(crop.endYear) - int(crop.startYear)) * 12 + (months_map[crop.endMonth] - months_map[crop.startMonth])
            duration = max(1, duration)
        except:
            duration = 3
            
        land = float(crop.landSize) if float(crop.landSize) > 0 else 1.0
        total_months += duration
        
        # Fertilizers සහ Pesticides එකතු කිරීම
        for chem in crop.fertilizers + crop.pesticides:
            if chem.name in chem_dict:
                n_val = chem_dict[chem.name]['N']
                p_val = chem_dict[chem.name]['P']
                k_val = chem_dict[chem.name]['K']
                
                multiplier = chem.amount_g / 100.0
                added_n = (n_val * multiplier) / land
                added_p = (p_val * multiplier) / land
                added_k = (k_val * multiplier) / land
                
                total_n_added += added_n
                total_p_added += added_p
                total_k_added += added_k
                
                chemical_breakdown.append({
                    "name": chem.name,
                    "amount_g": chem.amount_g,
                    "base_100g": {"N": float(n_val), "P": float(p_val), "K": float(k_val)},
                    "added": {"N": float(added_n), "P": float(added_p), "K": float(added_k)}
                })
    
    base_n = baseline.get('N', 50.0)
    base_p = baseline.get('P', 20.0)
    base_k = baseline.get('K', 100.0)
    
    features = np.array([[base_n, base_p, base_k, total_n_added, total_p_added, total_k_added, total_months]])
    features_scaled = npk_scaler.transform(features)
    pred = npk_model.predict(features_scaled)[0]
    
    current_n, current_p, current_k = max(0, pred[0]), max(0, pred[1]), max(0, pred[2])
    return current_n, current_p, current_k, chemical_breakdown


# ---------- Rule‑based Suitability Check ----------
def is_crop_suitable(current_n, current_p, current_k, requirements):
    """Returns True if current NPK values are within the required min‑max range."""
    req_n_min = requirements.get("Min_Nitrogen_ppm", 0)
    req_n_max = requirements.get("Max_Nitrogen_ppm", 999999)
    req_p_min = requirements.get("Min_Phosphorus_ppm", 0)
    req_p_max = requirements.get("Max_Phosphorus_ppm", 999999)
    req_k_min = requirements.get("Min_Potassium_ppm", 0)
    req_k_max = requirements.get("Max_Potassium_ppm", 999999)
    
    return (req_n_min <= current_n <= req_n_max and
            req_p_min <= current_p <= req_p_max and
            req_k_min <= current_k <= req_k_max)

# ---------- Pydantic Models ----------
class ChemicalItem(BaseModel):
    name: str
    amount_g: int

class CropHistory(BaseModel):
    cropName: str
    landSize: float
    startMonth: str
    startYear: str
    endMonth: str
    endYear: str
    fertilizers: List[ChemicalItem]
    pesticides: List[ChemicalItem]

class RotationRequest(BaseModel):
    targetCrop: str
    targetLandSize: float
    currentMonth: str
    previousCrops: List[CropHistory]
    language: str
    baselineNutrients: Dict[str, float]

class GuidanceRequest(BaseModel):
    district: str
    month: str
    language: str

# ---------- Start-up Loaders ----------
load_npk_predictor()
load_agrochemical_data()
if not load_crop_rec_models():
    if train_crop_recommendation_model():
        load_crop_rec_models()

# ---------- Endpoints ----------
@app.post("/predict_npk")
async def predict_npk(req: RotationRequest):
    # Unpack the 4 values
    current_n, current_p, current_k, chemical_breakdown = calculate_current_npk(req.baselineNutrients, req.previousCrops)
    return {
        "current_n": float(current_n),
        "current_p": float(current_p),
        "current_k": float(current_k),
        "chemical_breakdown": chemical_breakdown # Send to Node JS
    }

@app.get("/get_requirements/{crop_name}")
async def get_requirements(crop_name: str):
    # Target Crop එකට අදාල දත්ත CSV හෝ AI මගින් ලබා දීම
    target_requirements = get_or_create_nutrients(crop_name)
    if not target_requirements:
        return {"error": "Failed to determine crop requirements."}
    return target_requirements

# ---------- Crop Recommendation & Steps Endpoints (unchanged) ----------
@app.post("/recommend_crops")
async def recommend_crops(req: GuidanceRequest):
    global crop_rec_model, crop_rec_encoder, crop_rec_mlb
    if crop_rec_model is None:
        if train_crop_recommendation_model():
            load_crop_rec_models()
        else:
            return {"error": "ML Model is not trained and dataset is missing!"}
    input_data = pd.DataFrame([{"District": req.district.title(), "Month_Name": req.month.title()}])
    try:
        X_input = crop_rec_encoder.transform(input_data)
        y_pred = crop_rec_model.predict(X_input)
        predicted_crops = crop_rec_mlb.inverse_transform(y_pred)[0]
    except Exception as e:
        return {"success": False, "message": f"Prediction failed for {req.district}."}
    if not predicted_crops:
        return {"success": False, "message": f"No crops predicted for {req.district} in {req.month}."}
    recommendations = []
    for crop in predicted_crops:
        reasoning_text = f"Based on ML predictions, {crop} is highly suitable for cultivation in {req.district} during {req.month} considering the seasonal and geographical patterns."
        recommendations.append({
            "cropName": crop,
            "reasoning": reasoning_text,
            "steps": []
        })
    return {"success": True, "data": recommendations}

@app.get("/get_crop_steps/{crop_name}")
async def get_crop_steps(crop_name: str, language: str = "English"):
    steps_csv = os.path.join(DATA_DIR, "cultivation_steps.csv")
    if os.path.exists(steps_csv):
        df = pd.read_csv(steps_csv).fillna("")
        crop_data = df[df['Crop_Name'].str.lower() == crop_name.lower()]
        if not crop_data.empty:
            formatted_steps = []
            for raw in crop_data.to_dict('records'):
                try:
                    est_days = int(float(raw.get("Estimated_Days", 0)))
                except:
                    est_days = 0
                formatted_steps.append({
                    "stage": str(raw.get("Stage", "")),
                    "instructions": str(raw.get("Instructions", "")),
                    "estimatedDays": est_days,
                    "alert": str(raw.get("Alert", ""))
                })
            return {"success": True, "steps": formatted_steps}
    print(f"[AI INFO] Generating steps for '{crop_name}' via AI...")
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
        if not os.path.exists(steps_csv):
            new_df.to_csv(steps_csv, index=False)
        else:
            new_df.to_csv(steps_csv, mode='a', header=False, index=False)
        print(f"[AI INFO] Steps for '{crop_name}' saved to CSV.")
        return {"success": True, "steps": ai_steps}
    except Exception as e:
        print(f"AI Error: {e}")
        return {"success": False, "message": "Failed to generate steps via AI."}