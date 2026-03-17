# backend/model/guidance_train.py
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
import pickle
import os

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")
SUITABILITY_CSV = os.path.join(DATA_DIR, "district_suitability.csv")

def train_guidance_model():
    os.makedirs(MODEL_DIR, exist_ok=True)
    
    if not os.path.exists(SUITABILITY_CSV):
        print("❌ Cannot train guidance model: dataset missing.")
        return False
        
    df = pd.read_csv(SUITABILITY_CSV)
    if len(df) < 3:
        return False # Not enough data to train
        
    print("Training Guidance Recommendation Model...")
    
    # Encode Categorical Data
    district_encoder = LabelEncoder()
    crop_encoder = LabelEncoder()
    
    df['District_Encoded'] = district_encoder.fit_transform(df['District'])
    df['Crop_Encoded'] = crop_encoder.fit_transform(df['Crop_Name'])
    
    X = df[['District_Encoded', 'Month_Num', 'Crop_Encoded']]
    y = df['Is_Suitable']
    
    # Train Model
    classifier = RandomForestClassifier(n_estimators=50, random_state=42)
    classifier.fit(X, y)
    
    # Save Model and Encoders
    with open(os.path.join(MODEL_DIR, "crop_recommender.pkl"), "wb") as f:
        pickle.dump(classifier, f)
    with open(os.path.join(MODEL_DIR, "district_encoder.pkl"), "wb") as f:
        pickle.dump(district_encoder, f)
    with open(os.path.join(MODEL_DIR, "crop_encoder.pkl"), "wb") as f:
        pickle.dump(crop_encoder, f)
        
    print("✅ Guidance ML Model successfully trained and saved!")
    return True

if __name__ == "__main__":
    train_guidance_model()