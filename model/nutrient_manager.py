# backend/model/nutrient_manager.py
import os
import pandas as pd
import json
import re
from google import genai
from dotenv import load_dotenv

# --- Locked Absolute Paths ---
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
CSV_PATH = os.path.join(DATA_DIR, "nutrients_data_set.csv")

COLUMNS = [
    "Crop_Name_EN", "Crop_Name_SI", 
    "Min_Nitrogen_ppm", "Min_Phosphorus_ppm", "Min_Potassium_ppm",
    "Min_Calcium_ppm", "Min_Magnesium_ppm"
]

# Robust Env Loading (Walks up the directory tree to find .env)
ROOT_DIR = os.path.dirname(CURRENT_DIR)
env_path = os.path.join(ROOT_DIR, ".env")
if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path)
    print(f"✅ Loaded .env from {env_path}")
else:
    print(f"⚠️ WARNING: .env file NOT found at {env_path}")

def get_ai_client():
    try:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            print("⚠️ ERROR: GEMINI_API_KEY is empty or missing.")
            return None
        return genai.Client(api_key=api_key)
    except Exception as e:
        print(f"⚠️ ERROR initializing AI Client: {e}")
        return None

def initialize_csv():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CSV_PATH):
        df = pd.DataFrame(columns=COLUMNS)
        df.to_csv(CSV_PATH, index=False)
        print(f"✅ Created new reference dataset at {CSV_PATH}")

def fallback_crop_data(crop_name):
    """If the AI fails, use this safe default so the ML pipeline doesn't crash."""
    print(f"⚠️ Using fallback default data for {crop_name}")
    safe_data = {
        "Crop_Name_EN": crop_name,
        "Crop_Name_SI": crop_name,
        "Min_Nitrogen_ppm": 40.0,
        "Min_Phosphorus_ppm": 20.0,
        "Min_Potassium_ppm": 60.0,
        "Min_Calcium_ppm": 500.0,
        "Min_Magnesium_ppm": 50.0
    }
    new_row_df = pd.DataFrame([safe_data], columns=COLUMNS)
    new_row_df.to_csv(CSV_PATH, mode='a', header=False, index=False)
    return safe_data

def fetch_from_ai_and_save(crop_name):
    print(f"Connecting to AI to fetch nutrients for '{crop_name}'...")
    
    client = get_ai_client()
    if not client:
        return fallback_crop_data(crop_name)

    prompt = f"""
    Provide the minimum ideal soil nutrient levels (in ppm) required to grow '{crop_name}'.
    Return ONLY a JSON object. No markdown, no extra text.
    {{
        "Crop_Name_EN": "English Name",
        "Crop_Name_SI": "Sinhala Name",
        "Min_Nitrogen_ppm": 50,
        "Min_Phosphorus_ppm": 20,
        "Min_Potassium_ppm": 100,
        "Min_Calcium_ppm": 1000,
        "Min_Magnesium_ppm": 100
    }}
    """
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        
        # Aggressive JSON extraction
        match = re.search(r'\{.*\}', response.text, re.DOTALL)
        if not match:
            print("❌ AI did not return a valid JSON block.")
            return fallback_crop_data(crop_name)
            
        data = json.loads(match.group(0))
        
        safe_data = {
            "Crop_Name_EN": str(data.get("Crop_Name_EN", crop_name)),
            "Crop_Name_SI": str(data.get("Crop_Name_SI", crop_name)),
            "Min_Nitrogen_ppm": float(data.get("Min_Nitrogen_ppm", 40.0)),
            "Min_Phosphorus_ppm": float(data.get("Min_Phosphorus_ppm", 20.0)),
            "Min_Potassium_ppm": float(data.get("Min_Potassium_ppm", 60.0)),
            "Min_Calcium_ppm": float(data.get("Min_Calcium_ppm", 500.0)),
            "Min_Magnesium_ppm": float(data.get("Min_Magnesium_ppm", 50.0))
        }
        
        new_row_df = pd.DataFrame([safe_data], columns=COLUMNS)
        new_row_df.to_csv(CSV_PATH, mode='a', header=False, index=False)
        print(f"✅ Data for {crop_name} saved securely to {CSV_PATH}")
        return safe_data
        
    except Exception as e:
        print(f"❌ ERROR parsing AI data: {e}")
        return fallback_crop_data(crop_name)

def get_or_create_nutrients(crop_name):
    initialize_csv()
    
    try:
        df = pd.read_csv(CSV_PATH)
        search_term = str(crop_name).strip().lower()
        
        if 'Crop_Name_EN' in df.columns:
            match = df[(df['Crop_Name_EN'].astype(str).str.lower() == search_term) | 
                       (df['Crop_Name_SI'].astype(str).str.lower() == search_term)]
            if not match.empty:
                print(f"✅ Crop '{crop_name}' found locally. Skipping AI.")
                return match.iloc[0].to_dict()
    except Exception as e:
        print(f"⚠️ Error reading local CSV: {e}. Rebuilding...")
        
    return fetch_from_ai_and_save(crop_name)

# --- DIRECT TEST EXECUTION ---
if __name__ == "__main__":
    print("--- Testing Nutrient Manager directly ---")
    result = get_or_create_nutrients("TestCrop_Carrot")
    print(result)