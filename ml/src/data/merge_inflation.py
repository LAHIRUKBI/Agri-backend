import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[3]

BASE_DATASET_PATH = BASE_DIR / "datasets" / "interim" / "final_dataset_with_weather.csv"
INFLATION_PATH = BASE_DIR / "datasets" / "interim" / "weekly_inflation.csv"
OUTPUT_PATH = BASE_DIR / "datasets" / "interim" / "final_dataset_with_weather_inflation.csv"


def merge_inflation():
    base_df = pd.read_csv(BASE_DATASET_PATH)
    inflation_df = pd.read_csv(INFLATION_PATH)

    base_df["year"] = pd.to_numeric(base_df["year"], errors="coerce")
    base_df["month"] = pd.to_numeric(base_df["month"], errors="coerce")
    base_df["week_number"] = pd.to_numeric(base_df["week_number"], errors="coerce")

    inflation_df["year"] = pd.to_numeric(inflation_df["year"], errors="coerce")
    inflation_df["month"] = pd.to_numeric(inflation_df["month"], errors="coerce")
    inflation_df["week_number"] = pd.to_numeric(inflation_df["week_number"], errors="coerce")

    merged = pd.merge(
        base_df,
        inflation_df,
        on=["year", "month", "week_number"],
        how="left"
    )

    merged["inflation_rate"] = merged["inflation_rate"].fillna(merged["inflation_rate"].mean())
    merged["inflation_mom_change"] = merged["inflation_mom_change"].fillna(0)

    merged.to_csv(OUTPUT_PATH, index=False)
    print(f"[DONE] Dataset with inflation saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    merge_inflation()