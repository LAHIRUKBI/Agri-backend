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
agro_df = None               # loaded once at startup
crop_rec_model = None
crop_rec_encoder = None
crop_rec_mlb = None
soil_image_model = None
soil_image_feature_columns = None
soil_image_target_columns = None

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
    global agro_df
    agro_path = os.path.join(DATA_DIR, "Agrochemical_compounds.csv")
    if not os.path.exists(agro_path):
        print("⚠️ Agrochemical CSV missing. ML feature extraction will fallback.")
        return False
    df = pd.read_csv(agro_path)
    # Find N,P,K columns
    n_col = next((c for c in df.columns if 'nitrogen' in c.lower()), None)
    p_col = next((c for c in df.columns if 'phosphorus' in c.lower()), None)
    k_col = next((c for c in df.columns if 'potassium' in c.lower()), None)
    if not (n_col and p_col and k_col):
        print("⚠️ Could not find N,P,K columns in agrochemical CSV.")
        return False
    df.rename(columns={n_col: 'N', p_col: 'P', k_col: 'K'}, inplace=True)
    # Find Product_Name column
    name_col = next((c for c in df.columns if 'product' in c.lower() and 'name' in c.lower()), None)
    if name_col:
        df = df.drop_duplicates(subset=[name_col], keep='first')
        df.set_index(name_col, inplace=True)
    else:
        first_col = df.columns[0]
        df = df.drop_duplicates(subset=[first_col], keep='first')
        df.set_index(first_col, inplace=True)
    agro_df = df
    print(f"✅ Agrochemical composition loaded. {len(agro_df)} unique products.")
    return True

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

def load_soil_image_model():
    global soil_image_model, soil_image_feature_columns, soil_image_target_columns
    model_path = os.path.join(MODEL_DIR, "soil_image_assessor.pkl")
    if not os.path.exists(model_path):
        print("⚠️ Soil image model not found. Quick image check will use backend fallback.")
        return False
    try:
        with open(model_path, "rb") as f:
            artifact = pickle.load(f)
        soil_image_model = artifact["model"]
        soil_image_feature_columns = artifact["feature_columns"]
        soil_image_target_columns = artifact["target_columns"]
        print("✅ Soil image assessor model loaded.")
        return True
    except Exception as e:
        print(f"⚠️ Failed to load soil image model: {e}")
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
def deterministic_calculate_current_npk(baseline, past_crops):
    current_n = float(baseline.get('N', 50.0))
    current_p = float(baseline.get('P', 20.0))
    current_k = float(baseline.get('K', 100.0))
    chemical_breakdown = [] # Add this array

    months_map = {'January':1, 'February':2, 'March':3, 'April':4, 'May':5, 'June':6,
                  'July':7, 'August':8, 'September':9, 'October':10, 'November':11, 'December':12}
    
    local_agro_df = agro_df
    if local_agro_df is None:
        agro_path = os.path.join(DATA_DIR, "Agrochemical_compounds.csv")
        if os.path.exists(agro_path):
            try:
                temp_df = pd.read_csv(agro_path)
                n_col = next((c for c in temp_df.columns if 'nitrogen' in c.lower()), None)
                p_col = next((c for c in temp_df.columns if 'phosphorus' in c.lower()), None)
                k_col = next((c for c in temp_df.columns if 'potassium' in c.lower()), None)
                if n_col and p_col and k_col:
                    temp_df.rename(columns={n_col:'N', p_col:'P', k_col:'K'}, inplace=True)
                    name_col = next((c for c in temp_df.columns if 'product' in c.lower() and 'name' in c.lower()), None)
                    if name_col:
                        temp_df = temp_df.drop_duplicates(subset=[name_col], keep='first')
                        temp_df.set_index(name_col, inplace=True)
                    local_agro_df = temp_df
            except Exception as e:
                print(f"Error loading agro CSV in fallback: {e}")

    for crop in past_crops:
        try:
            duration = (int(crop.endYear) - int(crop.startYear)) * 12 + (months_map[crop.endMonth] - months_map[crop.startMonth])
            duration = max(1, duration)
        except:
            duration = 3
        land = float(crop.landSize) if float(crop.landSize) > 0 else 1.0
        
        current_n -= duration * 1.2
        current_p -= duration * 0.4
        current_k -= duration * 0.8
        
        if local_agro_df is not None:
            for chem in crop.fertilizers + crop.pesticides:
                if chem.name in local_agro_df.index:
                    try:
                        n_val = local_agro_df.loc[chem.name, 'N']
                        p_val = local_agro_df.loc[chem.name, 'P']
                        k_val = local_agro_df.loc[chem.name, 'K']
                        if isinstance(n_val, pd.Series): n_val = n_val.iloc[0]
                        if isinstance(p_val, pd.Series): p_val = p_val.iloc[0]
                        if isinstance(k_val, pd.Series): k_val = k_val.iloc[0]
                        multiplier = chem.amount_g / 100.0
                        added_n = (n_val * multiplier) / land
                        added_p = (p_val * multiplier) / land
                        added_k = (k_val * multiplier) / land
                        
                        current_n += added_n
                        current_p += added_p
                        current_k += added_k
                        
                        # Store breakdown for UI
                        chemical_breakdown.append({
                            "name": chem.name,
                            "amount_g": chem.amount_g,
                            "base_100g": {"N": float(n_val), "P": float(p_val), "K": float(k_val)},
                            "added": {"N": float(added_n), "P": float(added_p), "K": float(added_k)}
                        })
                    except Exception as e:
                        print(f"Warning: Could not add {chem.name}: {e}")
                        continue

    return max(0, current_n), max(0, current_p), max(0, current_k), chemical_breakdown

# ---------- ML‑based NPK Prediction (preferred) ----------
def calculate_current_npk(baseline, past_crops):
    global npk_model, npk_scaler, agro_df
    
    if npk_model is None or npk_scaler is None or agro_df is None:
        print("[WARN] ML model or agro data missing, using deterministic fallback.")
        return deterministic_calculate_current_npk(baseline, past_crops)
    
    total_n_added = 0.0
    total_p_added = 0.0
    total_k_added = 0.0
    total_months = 0
    chemical_breakdown = [] # Add this array
    
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
        
        for chem in crop.fertilizers + crop.pesticides:
            if chem.name in agro_df.index:
                n_val = agro_df.loc[chem.name, 'N']
                p_val = agro_df.loc[chem.name, 'P']
                k_val = agro_df.loc[chem.name, 'K']
                if isinstance(n_val, pd.Series): n_val = n_val.iloc[0]
                if isinstance(p_val, pd.Series): p_val = p_val.iloc[0]
                if isinstance(k_val, pd.Series): k_val = k_val.iloc[0]
                
                multiplier = chem.amount_g / 100.0
                added_n = (n_val * multiplier) / land
                added_p = (p_val * multiplier) / land
                added_k = (k_val * multiplier) / land
                
                total_n_added += added_n
                total_p_added += added_p
                total_k_added += added_k
                
                # Store breakdown for UI
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

class SoilImageAssessmentRequest(BaseModel):
    district: str
    season: str = "Maha"
    cropType: str = ""
    language: str = "English"
    imageMetrics: Dict[str, float]


def classify_soil_image_metrics(image_metrics: Dict[str, float]):
    brightness = float(image_metrics.get("brightness", 0.0))
    texture_score = float(image_metrics.get("textureScore", 0.0))
    red_mean = float(image_metrics.get("redMean", 0.0))
    green_mean = float(image_metrics.get("greenMean", 0.0))
    blue_mean = float(image_metrics.get("blueMean", 0.0))
    earthy_ratio = float(image_metrics.get("earthyRatio", 0.0))
    blue_ratio = float(image_metrics.get("blueRatio", 0.0))
    green_ratio = float(image_metrics.get("greenRatio", 0.0))
    edge_density = float(image_metrics.get("edgeDensity", 0.0))

    channel_spread = max(red_mean, green_mean, blue_mean) - min(red_mean, green_mean, blue_mean)

    checks = {
        "earth_dominance": earthy_ratio >= 0.34,
        "low_blue_scene": blue_ratio <= 0.22,
        "low_green_scene": green_ratio <= 0.28,
        "close_texture": texture_score >= 24 and edge_density >= 0.12,
        "balanced_light": 35 <= brightness <= 205,
        "balanced_channels": channel_spread <= 105 and red_mean >= blue_mean - 5
    }

    passed_checks = sum(1 for passed in checks.values() if passed)
    confidence = round(passed_checks / len(checks), 2)
    is_soil_image = passed_checks >= 5 and checks["earth_dominance"] and checks["close_texture"]

    failed_reasons = []
    if not checks["earth_dominance"]:
        failed_reasons.append("Earth-tone pixel dominance is too low.")
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

    return {
        "is_soil_image": is_soil_image,
        "confidence": confidence,
        "label": "soil_close_up" if is_soil_image else "non_soil_or_wide_scene",
        "failed_reasons": failed_reasons,
        "checks": checks
    }

# ---------- Start-up Loaders ----------
load_npk_predictor()
load_agrochemical_data()
if not load_crop_rec_models():
    if train_crop_recommendation_model():
        load_crop_rec_models()
load_soil_image_model()

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

@app.post("/soil_image_assess")
async def soil_image_assess(req: SoilImageAssessmentRequest):
    global soil_image_model, soil_image_feature_columns, soil_image_target_columns

    image_classification = classify_soil_image_metrics(req.imageMetrics)
    if not image_classification["is_soil_image"]:
        return {
            "success": False,
            "message": "This image does not appear to be a valid close-up soil photo.",
            "isSoilImage": False,
            "imageClassification": image_classification
        }

    if soil_image_model is None or soil_image_feature_columns is None or soil_image_target_columns is None:
        return {
            "success": False,
            "message": "Soil image model is not trained yet.",
            "isSoilImage": True,
            "imageClassification": image_classification
        }

    raw_row = {
        "brightness": float(req.imageMetrics.get("brightness", 0.0)),
        "textureScore": float(req.imageMetrics.get("textureScore", 0.0)),
        "redMean": float(req.imageMetrics.get("redMean", 0.0)),
        "greenMean": float(req.imageMetrics.get("greenMean", 0.0)),
        "blueMean": float(req.imageMetrics.get("blueMean", 0.0)),
        "district": req.district,
        "season": req.season or "Maha"
    }

    feature_df = pd.DataFrame([raw_row])
    feature_df = pd.get_dummies(feature_df, columns=["district", "season"])
    feature_df = feature_df.reindex(columns=soil_image_feature_columns, fill_value=0)

    prediction = soil_image_model.predict(feature_df)[0]
    predicted = {
        target: round(float(value), 2)
        for target, value in zip(soil_image_target_columns, prediction)
    }

    return {
        "success": True,
        "predictedReadings": predicted,
        "isSoilImage": True,
        "imageClassification": image_classification
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
