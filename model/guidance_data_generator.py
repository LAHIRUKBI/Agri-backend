# backend/model/guidance_data_generator.py
import os
import pandas as pd
import json
from google import genai
from dotenv import load_dotenv

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
SUITABILITY_CSV = os.path.join(DATA_DIR, "district_suitability.csv")
STEPS_CSV = os.path.join(DATA_DIR, "cultivation_steps.csv")

ROOT_DIR = os.path.dirname(CURRENT_DIR)
load_dotenv(dotenv_path=os.path.join(ROOT_DIR, ".env"))
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

def initialize_guidance_csvs():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(SUITABILITY_CSV):
        pd.DataFrame(columns=["District", "Month_Num", "Crop_Name", "Is_Suitable"]).to_csv(SUITABILITY_CSV, index=False)
    if not os.path.exists(STEPS_CSV):
        pd.DataFrame(columns=["Crop_Name", "Stage", "Instructions", "Estimated_Days", "Alert"]).to_csv(STEPS_CSV, index=False)

def month_to_num(month_str):
    months = {"january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6, 
              "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12}
    return months.get(str(month_str).lower().strip(), 1)

def fetch_and_save_district_data(district, month_str):
    initialize_guidance_csvs()
    month_num = month_to_num(month_str)
    
    print(f"Connecting to AI: Fetching data for {district} in {month_str}...")
    
    prompt = f"""
    List 5 suitable crops to grow in the {district} district of Sri Lanka during {month_str}.
    Also provide the standard cultivation steps for each crop.
    Return ONLY a raw JSON object with no markdown tags, exactly matching this structure:
    {{
        "crops": ["Eggplant", "Tomato"],
        "steps": [
            {{"Crop_Name": "Eggplant", "Stage": "Land Preparation", "Instructions": "Dig holes...", "Estimated_Days": 7, "Alert": "Check for root rot"}},
            {{"Crop_Name": "Eggplant", "Stage": "Seed Selection", "Instructions": "Select hybrid...", "Estimated_Days": 1, "Alert": "None"}}
        ]
    }}
    Ensure stages include: Land Preparation, Seed Selection, Fertilizer Schedule, Irrigation, Pest/Disease Control, Harvest.
    """
    
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        raw_json = response.text.replace('```json', '').replace('```', '').strip()
        data = json.loads(raw_json)
        
        # 1. Save Suitability Data
        suitability_rows = [{"District": district, "Month_Num": month_num, "Crop_Name": crop, "Is_Suitable": 1} for crop in data["crops"]]
        pd.DataFrame(suitability_rows).to_csv(SUITABILITY_CSV, mode='a', header=False, index=False)
        
        # 2. Save Steps Data (Only if crop doesn't already exist in steps CSV)
        existing_steps = pd.read_csv(STEPS_CSV)
        new_steps = []
        for step in data["steps"]:
            if step["Crop_Name"] not in existing_steps['Crop_Name'].values:
                new_steps.append(step)
                
        if new_steps:
            pd.DataFrame(new_steps).to_csv(STEPS_CSV, mode='a', header=False, index=False)
            
        print(f"✅ Data for {district} successfully fetched and saved to local datasets.")
        return True
    except Exception as e:
        print(f"❌ ERROR fetching guidance data: {e}")
        return False

def fetch_and_save_crop_steps(crop_name):
    """Fetches missing steps for a specific crop and saves them to the dataset."""
    initialize_guidance_csvs()
    print(f"⚠️ Steps for '{crop_name}' are missing locally. Fetching from AI...")
    
    prompt = f"""
    Provide the standard cultivation steps for growing '{crop_name}' in Sri Lanka.
    Return ONLY a raw JSON array with no markdown tags, exactly matching this structure:
    [
        {{"Crop_Name": "{crop_name}", "Stage": "Land Preparation", "Instructions": "Detailed instructions...", "Estimated_Days": 7, "Alert": "Check for pests"}},
        {{"Crop_Name": "{crop_name}", "Stage": "Seed Selection", "Instructions": "Select quality seeds...", "Estimated_Days": 1, "Alert": "None"}}
    ]
    Ensure stages strictly include: Land Preparation, Seed Selection, Fertilizer Schedule, Irrigation, Pest/Disease Control, Harvest.
    """
    
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        raw_json = response.text.replace('```json', '').replace('```', '').strip()
        data = json.loads(raw_json)
        
        # Save the new steps to the CSV
        pd.DataFrame(data).to_csv(STEPS_CSV, mode='a', header=False, index=False)
        print(f"✅ Steps for {crop_name} successfully fetched and saved to local dataset.")
        return True
    except Exception as e:
        print(f"❌ ERROR fetching steps for {crop_name}: {e}")
        return False