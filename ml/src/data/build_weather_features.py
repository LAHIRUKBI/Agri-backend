import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[3]

RAW_PATH = BASE_DIR / "datasets" / "raw" / "SriLanka_Weather_Dataset.csv"
OUTPUT_PATH = BASE_DIR / "datasets" / "interim" / "weekly_weather.csv"


def build_weekly_weather():
    df = pd.read_csv(RAW_PATH)

    # normalize columns
    df["time"] = pd.to_datetime(df["time"])

    df["year"] = df["time"].dt.year
    df["week_number"] = df["time"].dt.isocalendar().week

    # normalize location
    df["city"] = df["city"].str.strip().str.lower()

    # aggregate weekly
    weekly = df.groupby(["city", "year", "week_number"]).agg({
        "temperature_2m_mean": "mean",
        "precipitation_sum": "sum",
        "rain_sum": "sum",
        "windspeed_10m_max": "mean"
    }).reset_index()

    # rename
    weekly = weekly.rename(columns={
        "city": "district",
        "temperature_2m_mean": "temp_mean",
        "precipitation_sum": "rainfall_total",
        "rain_sum": "rain_sum",
        "windspeed_10m_max": "wind_max"
    })

    weekly.to_csv(OUTPUT_PATH, index=False)

    print(f"[DONE] Weekly weather saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_weekly_weather()