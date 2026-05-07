import os
import random
from pathlib import Path

import numpy as np
import pandas as pd


CURRENT_DIR = Path(__file__).resolve().parent
DATA_DIR = CURRENT_DIR / "data"
IMAGES_DIR = DATA_DIR / "images"
OUTPUT_CSV = DATA_DIR / "soil_image_labels.csv"

DISTRICTS = [
    "Ampara", "Anuradhapura", "Badulla", "Batticaloa", "Colombo", "Galle", "Gampaha",
    "Hambantota", "Jaffna", "Kalutara", "Kandy", "Kegalle", "Kilinochchi", "Kurunegala",
    "Mannar", "Matale", "Matara", "Moneragala", "Mullaitivu", "Nuwara Eliya",
    "Polonnaruwa", "Puttalam", "Ratnapura", "Trincomalee", "Vavuniya"
]
SEASONS = ["Maha", "Yala", "Inter-monsoon"]
CROPS = ["Paddy", "Maize", "Banana", "Tomato", "Cabbage", "Carrot", "Potato", "Chilli"]


def clamp(value, low, high):
    return max(low, min(high, value))


def create_soil_targets():
    ph = round(random.uniform(4.9, 7.8), 2)
    moisture = round(random.uniform(10.0, 58.0), 2)
    organic_matter = round(random.uniform(1.0, 6.4), 2)
    nitrogen = round(clamp(35 + moisture * 1.9 + organic_matter * 10 + random.uniform(-12, 12), 25, 210), 2)
    phosphorus = round(clamp(8 + organic_matter * 5.2 + random.uniform(-6, 6), 8, 68), 2)
    potassium = round(clamp(25 + moisture * 1.5 + random.uniform(-10, 12), 20, 175), 2)
    return ph, nitrogen, phosphorus, potassium, moisture, organic_matter


def render_soil_image(ph, moisture, organic_matter, nitrogen, phosphorus, potassium):
    base_red = clamp(95 + (ph - 5.5) * 28 + phosphorus * 0.35, 55, 205)
    base_green = clamp(70 + moisture * 1.7 + organic_matter * 7, 45, 205)
    base_blue = clamp(45 + organic_matter * 6 + (170 - potassium) * 0.22, 28, 170)
    texture_strength = clamp(8 + organic_matter * 6 + moisture * 0.18, 8, 42)

    image = np.zeros((224, 224, 3), dtype=np.float32)
    image[:, :, 0] = base_red
    image[:, :, 1] = base_green
    image[:, :, 2] = base_blue

    noise = np.random.normal(0, texture_strength, size=(224, 224, 3))
    image += noise

    for _ in range(random.randint(6, 14)):
        x = random.randint(0, 180)
        y = random.randint(0, 180)
        w = random.randint(18, 52)
        h = random.randint(18, 52)
        patch_width = min(w, 224 - x)
        patch_height = min(h, 224 - y)
        patch = np.array(
            [
                clamp(base_red + random.uniform(-18, 18), 40, 220),
                clamp(base_green + random.uniform(-18, 18), 35, 220),
                clamp(base_blue + random.uniform(-18, 18), 20, 190),
            ],
            dtype=np.float32,
        )
        image[y : y + patch_height, x : x + patch_width] = patch + np.random.normal(
            0,
            texture_strength / 2,
            size=(patch_height, patch_width, 3),
        )

    return np.clip(image, 0, 255).astype(np.uint8)


def save_ppm(image_array: np.ndarray, output_path: Path):
    height, width, _ = image_array.shape
    with open(output_path, "wb") as image_file:
        image_file.write(f"P6\n{width} {height}\n255\n".encode("ascii"))
        image_file.write(image_array.tobytes())


def generate_dataset(sample_count=2000, seed=42):
    random.seed(seed)
    np.random.seed(seed)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    rows = []
    for index in range(1, sample_count + 1):
        district = random.choice(DISTRICTS)
        season = random.choice(SEASONS)
        crop = random.choice(CROPS)
        ph, nitrogen, phosphorus, potassium, moisture, organic_matter = create_soil_targets()
        image = render_soil_image(ph, moisture, organic_matter, nitrogen, phosphorus, potassium)

        image_name = f"sample_{index:04d}.ppm"
        image_path = IMAGES_DIR / image_name
        save_ppm(image, image_path)

        rows.append(
            {
                "image_path": f"images/{image_name}",
                "district": district,
                "season": season,
                "crop_type": crop,
                "ph": ph,
                "nitrogen": nitrogen,
                "phosphorus": phosphorus,
                "potassium": potassium,
                "moisture": moisture,
                "organicMatter": organic_matter,
            }
        )

    pd.DataFrame(rows).to_csv(OUTPUT_CSV, index=False)
    print(f"Generated {sample_count} dummy samples.")
    print(f"CSV saved to: {OUTPUT_CSV}")
    print(f"Images saved to: {IMAGES_DIR}")


if __name__ == "__main__":
    generate_dataset()
