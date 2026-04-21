from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    crop: str
    district: str
    market: str
    price_rs_kg: float = Field(..., gt=0)
    horizon: int = Field(default=1, ge=1, le=4)