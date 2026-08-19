import os
import pickle
from typing import Dict

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(CURRENT_DIR, "data")
MODEL_DIR = os.path.join(CURRENT_DIR, "saved_models")
DATASET_CSV = os.path.join(DATA_DIR, "soil_image_labels.csv")
MODEL_PATH = os.path.join(MODEL_DIR, "soil_image_assessor.pkl")

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(MODEL_DIR, exist_ok=True)

TARGET_COLUMNS = ["ph", "nitrogen", "phosphorus", "potassium", "moisture", "organicMatter"]


def extract_image_metrics(image_path: str) -> Dict[str, float]:
    with open(image_path, "rb") as image_file:
        header = image_file.readline().strip()
        if header != b"P6":
            raise ValueError(f"Unsupported image format for {image_path}. Expected binary PPM (P6).")

        dimensions_line = image_file.readline().strip()
        while dimensions_line.startswith(b"#"):
            dimensions_line = image_file.readline().strip()
        width, height = map(int, dimensions_line.split())

        max_value = int(image_file.readline().strip())
        if max_value != 255:
            raise ValueError(f"Unsupported max value in {image_path}: {max_value}")

        raw = image_file.read()
        pixels = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3)).astype(np.float32)

    red = pixels[:, :, 0]
    green = pixels[:, :, 1]
    blue = pixels[:, :, 2]
    brightness_map = 0.299 * red + 0.587 * green + 0.114 * blue

    brightness = float(np.mean(brightness_map))
    texture_score = float(min(100.0, np.sqrt(np.var(brightness_map))))

    return {
      "brightness": round(brightness, 2),
      "textureScore": round(texture_score, 2),
      "redMean": round(float(np.mean(red)), 2),
      "greenMean": round(float(np.mean(green)), 2),
      "blueMean": round(float(np.mean(blue)), 2)
    }


def load_dataset() -> pd.DataFrame:
    if not os.path.exists(DATASET_CSV):
        raise FileNotFoundError(
            f"Dataset file not found: {DATASET_CSV}\n"
            "Create this CSV first using the template in model/data/soil_image_labels_template.csv"
        )

    df = pd.read_csv(DATASET_CSV).fillna("")
    required_columns = ["image_path", "district", "season", *TARGET_COLUMNS]
    missing = [column for column in required_columns if column not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns in dataset CSV: {missing}")

    rows = []
    for row in df.to_dict("records"):
        image_path = str(row["image_path"]).strip()
        if not image_path:
            continue

        full_image_path = image_path
        if not os.path.isabs(full_image_path):
            full_image_path = os.path.join(DATA_DIR, image_path)

        if not os.path.exists(full_image_path):
            print(f"Skipping missing image: {full_image_path}")
            continue

        metrics = extract_image_metrics(full_image_path)
        rows.append(
            {
                **metrics,
                "district": row["district"],
                "season": row["season"],
                "cropType": row.get("crop_type", ""),
                "ph": float(row["ph"]),
                "nitrogen": float(row["nitrogen"]),
                "phosphorus": float(row["phosphorus"]),
                "potassium": float(row["potassium"]),
                "moisture": float(row["moisture"]),
                "organicMatter": float(row["organicMatter"]),
            }
        )

    prepared_df = pd.DataFrame(rows)
    if prepared_df.empty:
        raise ValueError("No valid dataset rows were found. Check image paths and CSV values.")

    return prepared_df


def train_model():
    df = load_dataset()
    print(f"Loaded {len(df)} labelled soil images.")

    feature_df = df[["brightness", "textureScore", "redMean", "greenMean", "blueMean", "district", "season"]].copy()
    feature_df = pd.get_dummies(feature_df, columns=["district", "season"])
    target_df = df[TARGET_COLUMNS].copy()

    X_train, X_test, y_train, y_test = train_test_split(
        feature_df, target_df, test_size=0.2, random_state=42
    )

    model = RandomForestRegressor(
        n_estimators=300,
        max_depth=18,
        min_samples_split=2,
        random_state=42,
        n_jobs=1
    )
    model.fit(X_train, y_train)

    predictions = model.predict(X_test)
    mae = mean_absolute_error(y_test, predictions, multioutput="raw_values")
    r2 = r2_score(y_test, predictions, multioutput="raw_values")

    print("\nModel evaluation")
    for index, target in enumerate(TARGET_COLUMNS):
        print(f"- {target}: MAE={mae[index]:.3f}, R2={r2[index]:.3f}")

    artifact = {
        "model": model,
        "feature_columns": X_train.columns.tolist(),
        "target_columns": TARGET_COLUMNS,
    }
    with open(MODEL_PATH, "wb") as model_file:
        pickle.dump(artifact, model_file)

    print(f"\nSaved soil image assessor model to: {MODEL_PATH}")


if __name__ == "__main__":
    train_model()
