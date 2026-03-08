# backend/model/train.py
import pandas as pd
from sklearn.ensemble import RandomForestRegressor, RandomForestClassifier
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
        
        # ML models need at least a few rows of data to find mathematical patterns
        if len(df) < 5:
            print("❌ Cannot train: Not enough data. Need at least 5 rows in the dataset.")
            return False
            
        X = df[["Prev_Months_Farmed", "Used_Urea", "Used_Compost"]]
        y_nutrients = df[["Resulting_N", "Resulting_P", "Resulting_K"]]
        y_suitable = df["Is_Suitable"]

        print("Training Machine Learning Models...")
        
        regressor = RandomForestRegressor(n_estimators=100, random_state=42)
        regressor.fit(X, y_nutrients)
        with open(os.path.join(MODEL_DIR, "nutrient_model.pkl"), "wb") as f:
            pickle.dump(regressor, f)

        classifier = RandomForestClassifier(n_estimators=100, random_state=42)
        classifier.fit(X, y_suitable)
        with open(os.path.join(MODEL_DIR, "suitability_model.pkl"), "wb") as f:
            pickle.dump(classifier, f)
            
        print("✅ Models successfully trained and saved!")
        return True
        
    except Exception as e:
        print(f"❌ Critical Training Error: {e}")
        return False

if __name__ == "__main__":
    train_models()