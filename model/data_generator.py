# backend/model/data_generator.py
import os
import pandas as pd
from google import genai
from dotenv import load_dotenv
import io

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
ML_DATASET_PATH = os.path.join(DATA_DIR, "farm_history_dataset.csv")

ML_COLUMNS = [
    "Target_Crop", "Prev_Months_Farmed", "Used_Urea", "Used_Compost", 
    "Resulting_N", "Resulting_P", "Resulting_K", "Is_Suitable"
]

ROOT_DIR = os.path.dirname(CURRENT_DIR)
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

def initialize_ml_csv():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(ML_DATASET_PATH):
        df = pd.DataFrame(columns=ML_COLUMNS)
        df.to_csv(ML_DATASET_PATH, index=False)
        print(f"✅ Created ML dataset at {ML_DATASET_PATH}")

def check_and_generate_data(target_crop):
    initialize_ml_csv()
    df = pd.read_csv(ML_DATASET_PATH)
    
    if target_crop.lower() in df['Target_Crop'].astype(str).str.lower().values:
        return False

    print(f"Generating synthetic training data for '{target_crop}'...")
    prompt = f"""
    Generate 30 realistic farming scenarios for '{target_crop}'.
    Return ONLY valid CSV. No headers, no formatting.
    Format exactly: {target_crop},12,1,0,45.5,20.1,110.0,1
    """
    
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        lines = response.text.split('\n')
        # Strict extraction: Must have commas, exclude markdown backticks
        valid_rows = [line.strip() for line in lines if ',' in line and not line.startswith('```')]
        
        if not valid_rows:
            raise ValueError("No valid CSV rows generated.")
            
        csv_raw = "\n".join(valid_rows)
        new_data = pd.read_csv(io.StringIO(csv_raw), names=ML_COLUMNS)
        new_data.to_csv(ML_DATASET_PATH, mode='a', header=False, index=False)
        print(f"✅ Added {len(new_data)} training rows for {target_crop}.")
        return True 
        
    except Exception as e:
        print(f"❌ ERROR generating ML Data: {e}")
        return False