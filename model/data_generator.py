# backend/model/data_generator.py
import os
import pandas as pd
import io
from google import genai
from dotenv import load_dotenv

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
ML_DATASET_PATH = os.path.join(DATA_DIR, "farm_history_dataset.csv")

ML_COLUMNS = ["Target_Crop", "Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K", "Is_Suitable"]

ROOT_DIR = os.path.dirname(CURRENT_DIR)
env_path = os.path.join(ROOT_DIR, ".env")
if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

def check_and_generate_data(target_crop):
    print(f"\n[DATA GENERATOR] ⚙️ Checking dataset for crop: '{target_crop}'")
    os.makedirs(DATA_DIR, exist_ok=True)
    
    if not os.path.exists(ML_DATASET_PATH):
        print("[DATA GENERATOR] 📁 farm_history_dataset.csv not found. Creating new file...")
        pd.DataFrame(columns=ML_COLUMNS).to_csv(ML_DATASET_PATH, index=False)

    try:
        df = pd.read_csv(ML_DATASET_PATH)
        if target_crop.lower() in df['Target_Crop'].astype(str).str.lower().values:
            print(f"[DATA GENERATOR] ✅ Data for '{target_crop}' exists. Skipping generation.")
            return False 
    except pd.errors.EmptyDataError:
        print("[DATA GENERATOR] ⚠️ CSV is empty, proceeding to generate data.")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("[DATA GENERATOR] ❌ ERROR: GEMINI_API_KEY is not loaded.")
        return False
        
    client = genai.Client(api_key=api_key)

    # UPDATED: Added realistic upper-bound constraints to justify ML usage
    prompt = f"""
    Generate 50 realistic agricultural data rows for '{target_crop}'.
    Columns exactly in this order: Target_Crop, Current_N, Current_P, Current_K, Req_N, Req_P, Req_K, Is_Suitable
    Rules: 
    - Is_Suitable = 1 if Current values are within an optimal range (slightly above or equal to Req values, but not exceeding 1.5x the Req values).
    - Is_Suitable = 0 if Current is lower than Req (deficiency).
    - Is_Suitable = 0 if Current is > 1.5x the Req (toxicity/over-fertilization).
    - Output ONLY pure CSV rows. No headers, no markdown blocks, no text. Numbers only for nutrient columns.
    Example:
    {target_crop},45.5,20.1,110.0,40.0,20.0,100.0,1
    """

    print(f"[DATA GENERATOR] 🤖 Requesting Gemini AI for 50 synthetic data points...")
    
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        clean_text = response.text.replace('```csv', '').replace('```', '').strip()
        
        valid_rows = [line.strip() for line in clean_text.split('\n') if line.count(',') == 7 and 'Target_Crop' not in line]
        
        if valid_rows:
            new_data = pd.read_csv(io.StringIO("\n".join(valid_rows)), names=ML_COLUMNS)
            new_data.to_csv(ML_DATASET_PATH, mode='a', header=False, index=False)
            print(f"[DATA GENERATOR] 🎉 SUCCESS: Saved {len(valid_rows)} new rows to dataset.")
            return True
        else:
            print("[DATA GENERATOR] ❌ AI response contained no valid CSV rows.")
            return False
            
    except Exception as e:
        print(f"[DATA GENERATOR] ❌ Critical Error: {e}")
        return False