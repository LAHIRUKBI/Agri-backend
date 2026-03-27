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
        
        if len(df) < 5:
            print("❌ Cannot train: Not enough data.")
            return False
            
        # අලුත් features ලබා දීම
        X = df[["Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K"]]
        y_suitable = df["Is_Suitable"]

        print("Training Machine Learning Models...")
        classifier = RandomForestClassifier(n_estimators=100, random_state=42)
        classifier.fit(X, y_suitable)
        
        with open(os.path.join(MODEL_DIR, "suitability_model.pkl"), "wb") as f:
            pickle.dump(classifier, f)
            
        print("✅ Models successfully trained and saved!")
        return True
        
    except Exception as e:
        print(f"❌ Critical Training Error: {e}")
        return False