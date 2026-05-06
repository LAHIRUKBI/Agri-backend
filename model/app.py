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

# Import directly from your existing logic
from nutrient_manager import get_or_create_nutrients

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
# වැදගත්: දැන් ඔබේ Training script එකේ හැදෙන model නම npk_research_model.pkl විය හැක.
# එසේනම් පහත model_path සහ scaler_path වල නම් වෙනස් කරගන්න. 
# (මම මෙහි දැනට ඔබේ කලින් තිබූ පරණ නම්ම භාවිතා කර ඇත.)
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")
DATA_DIR = os.path.join(CURRENT_DIR, "data")
os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(DATA_DIR, exist_ok=True)

# ---------- Global ML models ----------
npk_model = None
npk_scaler = None
chem_dict = None
crop_rec_model = None
crop_rec_encoder = None
crop_rec_mlb = None

def load_npk_predictor():
    global npk_model, npk_scaler
    # මෙහි නම් ඔබගේ Training Code එකෙන් save කළ නම් වලට ගැලපෙන සේ වෙනස් කරගන්න 
    # (උදා: "npk_research_model.pkl")
    model_path = os.path.join(MODEL_DIR, "npk_research_model.pkl") 
    scaler_path = os.path.join(MODEL_DIR, "npk_research_scaler.pkl")
    
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

def load_agrochemical_data():
    global chem_dict
    dict_path = os.path.join(MODEL_DIR, "chemical_composition.pkl")
    if os.path.exists(dict_path):
        with open(dict_path, "rb") as f:
            chem_dict = pickle.load(f)
        print(f"✅ Loaded {len(chem_dict)} agrochemical compositions.")
        return True
    else:
        print("⚠️ chemical_composition.pkl not found!")
        return False

def load_crop_rec_models():
    global crop_rec_model, crop_rec_encoder, crop_rec_mlb
    try:
        with open(os.path.join(MODEL_DIR, "crop_rec_model.pkl"), "rb") as f:
            crop_rec_model = pickle.load(f)
        with open(os.path.join(MODEL_DIR, "crop_rec_encoder.pkl"), "rb") as f:
            crop_rec_encoder = pickle.load(f)
        with open(os.path.join(MODEL_DIR, "crop_rec_mlb.pkl"), "rb") as f:
            crop_rec_mlb = pickle.load(f)
        print("✅ Pre-trained Crop Recommendation ML Models loaded successfully.")
        return True
    except Exception as e:
        print(f"⚠️ Error loading Crop Models: {e}.")
        return False

SQ_FT_PER_ACRE = 43560.0

# අලුතින් Environmental factors තුන ලබා ගනී
# main.py හි calculate_current_npk ශ්‍රිතය මෙලෙස නිවැරදි කරන්න

def calculate_current_npk(baseline, past_crops, soil_type, ph_level, rainfall):
    global npk_model, npk_scaler, chem_dict
    
    if npk_model is None or npk_scaler is None or chem_dict is None:
        print("[ERROR] ML model or chemical composition missing.")
        return 0, 0, 0, []
    
    total_n_added_per_sqft = 0.0
    total_p_added_per_sqft = 0.0
    total_k_added_per_sqft = 0.0
    total_months = 0
    chemical_breakdown = [] 
    
    months_map = {'January':1, 'February':2, 'March':3, 'April':4, 'May':5, 'June':6,
                  'July':7, 'August':8, 'September':9, 'October':10, 'November':11, 'December':12}
    
    for crop in past_crops:
        try:
            start = int(crop.startYear) * 12 + months_map[crop.startMonth]
            end = int(crop.endYear) * 12 + months_map[crop.endMonth]
            duration = max(1, end - start)
        except:
            duration = 3
            
        sq_ft = float(crop.landSize) * SQ_FT_PER_ACRE if float(crop.landSize) > 0 else SQ_FT_PER_ACRE
        total_months += duration
        
        # Fertilizers + Pesticides දෙකම එකතු කරන්න
        all_chemicals = crop.fertilizers + crop.pesticides
        for chem in all_chemicals:
            if chem.name in chem_dict:
                comp = chem_dict[chem.name]  # {'N': x, 'P': y, 'K': z}
                n_val = comp['N']
                p_val = comp['P']
                k_val = comp['K']
                
                multiplier = chem.amount_g / 100.0
                total_added_n = n_val * multiplier
                total_added_p = p_val * multiplier
                total_added_k = k_val * multiplier
                
                added_n_per_sqft = total_added_n / sq_ft
                added_p_per_sqft = total_added_p / sq_ft
                added_k_per_sqft = total_added_k / sq_ft
                
                total_n_added_per_sqft += added_n_per_sqft
                total_p_added_per_sqft += added_p_per_sqft
                total_k_added_per_sqft += added_k_per_sqft
                
                chemical_breakdown.append({
                    "name": chem.name,
                    "amount_g": chem.amount_g,
                    "base_100g": {"N": float(n_val), "P": float(p_val), "K": float(k_val)},
                    "added": {
                        "N": float(added_n_per_sqft), 
                        "P": float(added_p_per_sqft), 
                        "K": float(added_k_per_sqft)
                    }
                })
            else:
                print(f"Warning: Chemical '{chem.name}' not found in composition dict.")
    
    base_n = baseline.get('N', 50.0)
    base_p = baseline.get('P', 20.0)
    base_k = baseline.get('K', 100.0)
    
    # One-hot encoding for soil type
    soil_sandy = 1.0 if soil_type == 'Sandy' else 0.0
    soil_loam  = 1.0 if soil_type == 'Loam' else 0.0
    soil_clay  = 1.0 if soil_type == 'Clay' else 0.0

    # Features පෙළ ගැස්ම (training code එකට ගැලපෙන ලෙස)
    features = np.array([[
        base_n, base_p, base_k, 
        total_n_added_per_sqft, total_p_added_per_sqft, total_k_added_per_sqft, 
        total_months, 
        ph_level, rainfall, 
        soil_sandy, soil_loam, soil_clay
    ]])
    
    features_scaled = npk_scaler.transform(features)
    pred = npk_model.predict(features_scaled)[0]
    
    current_n = max(0, pred[0])
    current_p = max(0, pred[1])
    current_k = max(0, pred[2])
    return current_n, current_p, current_k, chemical_breakdown

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
    # අලුතින් එක් කළ Variables
    soilType: str
    phLevel: float
    rainfall: float
    currentMonth: str
    previousCrops: List[CropHistory]
    language: str
    baselineNutrients: Dict[str, float]

class GuidanceRequest(BaseModel):
    district: str
    month: str
    language: str

load_npk_predictor()
load_agrochemical_data()
load_crop_rec_models()

# ---------- Endpoints ----------
@app.post("/predict_npk")
async def predict_npk(req: RotationRequest):
    # Controller එකෙන් ආපු Environmental variables මෙතැනින් function එකට යවයි
    current_n, current_p, current_k, chemical_breakdown = calculate_current_npk(
        req.baselineNutrients, req.previousCrops, req.soilType, req.phLevel, req.rainfall
    )
    return {
        "current_n": float(current_n),
        "current_p": float(current_p),
        "current_k": float(current_k),
        "chemical_breakdown": chemical_breakdown 
    }

@app.get("/get_requirements/{crop_name}")
async def get_requirements(crop_name: str):
    target_requirements = get_or_create_nutrients(crop_name)
    if not target_requirements:
        return {"error": "Failed to determine crop requirements."}
    return target_requirements

@app.post("/recommend_crops")
async def recommend_crops(req: GuidanceRequest):
    global crop_rec_model, crop_rec_encoder, crop_rec_mlb
    if crop_rec_model is None:
        return {"error": "ML Model is missing! Please add Colab models to saved_models."}
        
    input_data = pd.DataFrame([{"District": req.district.title(), "Month_Name": req.month.title()}])
    
    try:
        X_input = crop_rec_encoder.transform(input_data)
        y_pred = crop_rec_model.predict(X_input)
        predicted_crops = crop_rec_mlb.inverse_transform(y_pred)[0]
    except Exception as e:
        return {"success": False, "message": f"Prediction failed for {req.district}: {str(e)}"}
        
    if not predicted_crops:
        return {"success": False, "message": f"No crops predicted for {req.district} in {req.month}."}
        
    SINHALA_CROPS = {
        "Rice": "වී", "Maize": "බඩඉරිඟු", "Tomato": "තක්කාලි", "Potato": "අර්තාපල්",
        "Cabbage": "ගෝවා", "Carrot": "කැරට්", "Bitter Gourd": "කරවිල",
        "Brinjal": "වම්බටු", "Chilli": "මිරිස්", "Pumpkin": "වට්ටක්කා",
        "Snake Gourd": "පතෝල", "Okra": "බණ්ඩක්කා", "Onion": "ළූණු",
        "Beans": "බෝංචි", "Cucumber": "පිපිඤ්ඤා", "Papaya": "ගස්ලබු",
        "Banana": "කෙසෙල්", "Mango": "අඹ", "Watermelon": "පැණි කොමඩු",
        "Pineapple": "අන්නාසි", "Green Gram": "මුං ඇට", "Cowpea": "කව්පි",
        "Peanut": "රටකජු", "Sweet Potato": "බතල", "Radish": "රාබු",
        "Leeks": "ලීක්ස්", "Beetroot": "බීට්රූට්", "Capsicum": "මාළු මිරිස්",
        "Ginger": "ඉඟුරු", "Turmeric": "කහ", "Garlic": "සුදු ළූණු"
    }

    recommendations = []
    for crop in predicted_crops:
        display_crop_name = SINHALA_CROPS.get(crop, crop) if req.language == "Sinhala" else crop
        recommendations.append({
            "cropName": display_crop_name,
            "reasoning": "", 
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