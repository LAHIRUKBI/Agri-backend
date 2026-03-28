import pandas as pd
from sklearn.ensemble import RandomForestClassifier
import pickle
import os

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ML_DATASET_PATH = os.path.join(CURRENT_DIR, "data", "farm_history_dataset.csv")
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")

def train_models():
    os.makedirs(MODEL_DIR, exist_ok=True)
    
    if not os.path.exists(ML_DATASET_PATH):
        print("❌ Cannot train: 'farm_history_dataset.csv' is missing.")
        return False
        
    try:
        df = pd.read_csv(ML_DATASET_PATH)
        
        # CRITICAL: Clean data to ensure all features are floats/ints. 
        # This prevents crashes if Gemini hallucinates strings into the CSV.
        numeric_cols = ["Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K", "Is_Suitable"]
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce')
            
        df = df.dropna(subset=numeric_cols) # Drop any rows that couldn't be converted to numbers
        
        if len(df) < 5:
            print("❌ Cannot train: Not enough valid numeric data points.")
            return False
            
        # Extract features and target
        X = df[["Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K"]]
        y_suitable = df["Is_Suitable"].astype(int)

        print(f"Training Random Forest Classifier on {len(df)} rows...")
        classifier = RandomForestClassifier(n_estimators=100, random_state=42)
        classifier.fit(X, y_suitable)
        
        with open(os.path.join(MODEL_DIR, "suitability_model.pkl"), "wb") as f:
            pickle.dump(classifier, f)
            
        print("✅ Suitability model successfully trained and saved!")
        return True
        
    except Exception as e:
        print(f"❌ Critical Training Error: {e}")
        return False