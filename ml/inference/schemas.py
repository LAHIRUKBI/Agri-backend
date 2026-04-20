from pydantic import BaseModel


class PredictRequest(BaseModel):
    crop: str
    district: str
    market: str
    season: str
    year: int
    month: int
    week_number: int
    price_rs_kg: float