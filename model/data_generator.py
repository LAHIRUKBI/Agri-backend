import os
import pandas as pd
import io
from google import genai
from dotenv import load_dotenv

# --- Locked Absolute Paths ---
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
ML_DATASET_PATH = os.path.join(DATA_DIR, "farm_history_dataset.csv")

ML_COLUMNS = ["Target_Crop", "Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K", "Is_Suitable"]

# Robust Env Loading (Walks up the directory tree to find .env)
ROOT_DIR = os.path.dirname(CURRENT_DIR)
env_path = os.path.join(ROOT_DIR, ".env")
if os.path.exists(env_path):
    load_dotenv(dotenv_path=env_path)
else:
    # Fallback to standard if running from the root
    load_dotenv()

def check_and_generate_data(target_crop):
    print(f"\n⚙️ Checking dataset for crop: '{target_crop}'")
    os.makedirs(DATA_DIR, exist_ok=True)
    
    # Create file with headers if it doesn't exist
    if not os.path.exists(ML_DATASET_PATH):
        print("📁 farm_history_dataset.csv not found. Creating new file...")
        pd.DataFrame(columns=ML_COLUMNS).to_csv(ML_DATASET_PATH, index=False)

    try:
        df = pd.read_csv(ML_DATASET_PATH)
        # Check if crop already has data
        if target_crop.lower() in df['Target_Crop'].astype(str).str.lower().values:
            print(f"✅ Data for '{target_crop}' already exists. Skipping generation.")
            return False 
    except pd.errors.EmptyDataError:
        print("⚠️ CSV is empty, proceeding to generate data.")

    # Initialize Gemini
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        print("❌ ERROR: GEMINI_API_KEY is not loaded. Check your .env path.")
        return False
        
    client = genai.Client(api_key=api_key)

    prompt = f"""
    Generate 40 realistic agricultural data rows for '{target_crop}'.
    Columns exactly in this order: Target_Crop, Current_N, Current_P, Current_K, Req_N, Req_P, Req_K, Is_Suitable
    Rules: 
    - Is_Suitable = 1 if Current values >= Req values.
    - Is_Suitable = 0 if Current is significantly lower than Req.
    - Output ONLY pure CSV rows. No headers, no markdown blocks, no text explanations.
    - Do NOT include units like 'ppm'. Numbers only.
    Example:
    {target_crop},45.5,20.1,110.0,50.0,20.0,100.0,1
    """

    print(f"🤖 Requesting AI to generate 40 synthetic data points for '{target_crop}'...")
    
    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        
        # Strip out potential markdown code blocks
        clean_text = response.text.replace('```csv', '').replace('```', '').strip()
        
        valid_rows = []
        for line in clean_text.split('\n'):
            line = line.strip()
            # Strict validation: Must have exactly 7 commas (8 columns) and not be the header
            if line.count(',') == 7 and 'Target_Crop' not in line:
                valid_rows.append(line)
        
        if len(valid_rows) > 0:
            # Convert to DataFrame and append
            new_data = pd.read_csv(io.StringIO("\n".join(valid_rows)), names=ML_COLUMNS)
            new_data.to_csv(ML_DATASET_PATH, mode='a', header=False, index=False)
            print(f"🎉 SUCCESS: Saved {len(valid_rows)} new rows to farm_history_dataset.csv.")
            return True
        else:
            print("❌ AI response contained no valid CSV rows. Raw AI output was:")
            print(clean_text[:200] + "...") # Print a snippet of what went wrong
            return False
            
    except Exception as e:
        print(f"❌ Critical Error during AI data generation: {e}")
        return False

# Quick test block
if __name__ == "__main__":
    check_and_generate_data("TestCrop")