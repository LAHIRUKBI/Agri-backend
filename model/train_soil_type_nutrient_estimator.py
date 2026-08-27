import os
import pickle

import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")
DATASET_CSV = os.path.join(DATA_DIR, "soil_type_nutrient_profiles_cleaned.csv")
MODEL_PATH = os.path.join(MODEL_DIR, "soil_type_nutrient_estimator.pkl")

TARGET_COLUMNS = ["ph", "nitrogen", "phosphorus", "potassium", "moisture", "organicMatter"]
FEATURE_COLUMNS = ["soil_type", "district", "season", "crop_type"]

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)


def load_dataset():
    if not os.path.exists(DATASET_CSV):
        raise FileNotFoundError(f"Dataset file not found: {DATASET_CSV}")

    df = pd.read_csv(DATASET_CSV).fillna("")
    missing = [column for column in [*FEATURE_COLUMNS, *TARGET_COLUMNS] if column not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns in dataset CSV: {missing}")
    return df


def train_model():
    df = load_dataset()
    print(f"Loaded {len(df)} soil nutrient rows.")

    feature_df = pd.get_dummies(df[FEATURE_COLUMNS].copy(), columns=FEATURE_COLUMNS)
    target_df = df[TARGET_COLUMNS].copy()

    X_train, X_test, y_train, y_test = train_test_split(
        feature_df, target_df, test_size=0.2, random_state=42
    )

    model = RandomForestRegressor(
        n_estimators=320,
        max_depth=16,
        min_samples_leaf=1,
        random_state=42,
        n_jobs=1,
    )
    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    mae = mean_absolute_error(y_test, predictions, multioutput="raw_values")
    r2 = r2_score(y_test, predictions, multioutput="raw_values")

    print("\nSoil-type nutrient model evaluation")
    for index, target in enumerate(TARGET_COLUMNS):
        print(f"- {target}: MAE={mae[index]:.3f}, R2={r2[index]:.3f}")

    artifact = {
        "model": model,
        "feature_columns": X_train.columns.tolist(),
        "target_columns": TARGET_COLUMNS,
    }

    with open(MODEL_PATH, "wb") as model_file:
        pickle.dump(artifact, model_file)

    print(f"\nSaved soil-type nutrient estimator to: {MODEL_PATH}")


if __name__ == "__main__":
    train_model()
