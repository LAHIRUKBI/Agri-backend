import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[3]

RAW_PATH = BASE_DIR / "datasets" / "raw" / "inflation_data.csv"
OUTPUT_PATH = BASE_DIR / "datasets" / "interim" / "weekly_inflation.csv"


def build_weekly_inflation():
    df = pd.read_csv(RAW_PATH)

    # Extract year + month from "Date"
    df["Date"] = df["Date"].astype(str)

    df["year"] = df["Date"].str.extract(r"(\d{4})").astype(int)

    month_map = {
        "January": 1, "February": 2, "March": 3,
        "April": 4, "May": 5, "June": 6,
        "July": 7, "August": 8, "September": 9,
        "October": 10, "November": 11, "December": 12
    }

    df["month_name"] = df["Date"].str.extract(r"\d{4}\s+(.*)")
    df["month"] = df["month_name"].map(month_map)

    # Use CCPI Headline Inflation
    df["inflation_rate"] = pd.to_numeric(
        df["CCPI Headline Inflation (Y-o-Y)"],
        errors="coerce"
    )

    df = df.dropna(subset=["year", "month", "inflation_rate"]).copy()
    df = df.sort_values(["year", "month"]).reset_index(drop=True)

    # month-to-month change
    df["inflation_mom_change"] = df["inflation_rate"].diff().fillna(0)

    # Expand monthly → weekly
    rows = []
    for _, row in df.iterrows():
        for week in range(1, 54):
            rows.append({
                "year": int(row["year"]),
                "month": int(row["month"]),
                "week_number": week,
                "inflation_rate": float(row["inflation_rate"]),
                "inflation_mom_change": float(row["inflation_mom_change"]),
            })

    weekly = pd.DataFrame(rows)
    weekly.to_csv(OUTPUT_PATH, index=False)

    print(f"[DONE] Weekly inflation saved: {OUTPUT_PATH}")


if __name__ == "__main__":
    build_weekly_inflation()