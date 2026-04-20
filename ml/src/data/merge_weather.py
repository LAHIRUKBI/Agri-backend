import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[3]

PRICE_PATH = BASE_DIR / "datasets" / "interim" / "final_dataset.csv"
WEATHER_PATH = BASE_DIR / "datasets" / "interim" / "weekly_weather.csv"

OUTPUT_PATH = BASE_DIR / "datasets" / "interim" / "final_dataset_with_weather.csv"


def merge_weather():
    price = pd.read_csv(PRICE_PATH)
    weather = pd.read_csv(WEATHER_PATH)

    # normalize
    price["district"] = price["district"].str.strip().str.lower()
    weather["district"] = weather["district"].str.strip().str.lower()

    merged = pd.merge(
        price,
        weather,
        on=["district", "year", "week_number"],
        how="left"
    )

    # fill missing weather
    merged["temp_mean"] = merged["temp_mean"].fillna(merged["temp_mean"].mean())
    merged["rainfall_total"] = merged["rainfall_total"].fillna(0)
    merged["rain_sum"] = merged["rain_sum"].fillna(0)
    merged["wind_max"] = merged["wind_max"].fillna(merged["wind_max"].mean())

    merged.to_csv(OUTPUT_PATH, index=False)

    print(f"[DONE] merged dataset saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    merge_weather()