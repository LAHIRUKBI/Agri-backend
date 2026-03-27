import os
import pandas as pd
import io
from google import genai
from dotenv import load_dotenv

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
ML_DATASET_PATH = os.path.join(DATA_DIR, "farm_history_dataset.csv")

ML_COLUMNS = ["Target_Crop", "Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K", "Is_Suitable"]

def check_and_generate_data(target_crop):
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(ML_DATASET_PATH):
        pd.DataFrame(columns=ML_COLUMNS).to_csv(ML_DATASET_PATH, index=False)

    df = pd.read_csv(ML_DATASET_PATH)
    if target_crop.lower() in df['Target_Crop'].astype(str).str.lower().values:
        return False

    load_dotenv()
    client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

    prompt = f"""
    Generate 40 realistic agricultural data rows for '{target_crop}'.
    Columns: Target_Crop, Current_N, Current_P, Current_K, Req_N, Req_P, Req_K, Is_Suitable
    Rules: 
    - Is_Suitable = 1 if Current values >= Req values.
    - Is_Suitable = 0 if Current is significantly lower than Req.
    - Output ONLY CSV rows, no markdown headers.
    Example: {target_crop},45.5,20.1,110.0,50.0,20.0,100.0,1
    """

    try:
        response = client.models.generate_content(model='gemini-1.5-flash', contents=prompt)
        valid_rows = [line.strip() for line in response.text.split('\n') if ',' in line]
        
        if valid_rows:
            new_data = pd.read_csv(io.StringIO("\n".join(valid_rows)), names=ML_COLUMNS)
            new_data.to_csv(ML_DATASET_PATH, mode='a', header=False, index=False)
            return True
    except Exception as e:
        print(f"Error generating data: {e}")
    return False