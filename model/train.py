# backend/model/train.py
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import pickle
import os

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ML_DATASET_PATH = os.path.join(CURRENT_DIR, "data", "farm_history_dataset.csv")
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")

def train_models():
    os.makedirs(MODEL_DIR, exist_ok=True)
    
    if not os.path.exists(ML_DATASET_PATH):
        print("[TRAINING] ❌ Cannot train: 'farm_history_dataset.csv' is missing.")
        return False
        
    try:
        df = pd.read_csv(ML_DATASET_PATH)
        
        numeric_cols = ["Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K", "Is_Suitable"]
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col], errors='coerce')
            
        df = df.dropna(subset=numeric_cols) 
        
        if len(df) < 10:
            print("[TRAINING] ❌ Cannot train: Not enough valid numeric data points.")
            return False
            
        X = df[["Current_N", "Current_P", "Current_K", "Req_N", "Req_P", "Req_K"]]
        y_suitable = df["Is_Suitable"].astype(int)

        # Split data to calculate real accuracy
        X_train, X_test, y_train, y_test = train_test_split(X, y_suitable, test_size=0.2, random_state=42)

        print(f"\n[TRAINING] 🧠 Training Random Forest on {len(X_train)} samples...")
        classifier = RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42)
        classifier.fit(X_train, y_train)
        
        # Test the model
        predictions = classifier.predict(X_test)
        acc = accuracy_score(y_test, predictions)
        
        with open(os.path.join(MODEL_DIR, "suitability_model.pkl"), "wb") as f:
            pickle.dump(classifier, f)
            
        print(f"[TRAINING] ✅ Model trained! Validation Accuracy: {acc * 100:.2f}%")
        return True
        
    except Exception as e:
        print(f"[TRAINING] ❌ Critical Error: {e}")
        return False