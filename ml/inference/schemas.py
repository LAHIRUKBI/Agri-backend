from typing import Literal

from pydantic import BaseModel, Field, model_validator


class PredictRequest(BaseModel):
    crop: str
    district: str
    market: str
    current_price_source: Literal["manual", "system"] = "manual"
    price_rs_kg: float | None = Field(default=None, gt=0)
    horizon: Literal[1] = 1

    @model_validator(mode="after")
    def validate_price_source_contract(self):
        if self.current_price_source == "manual" and self.price_rs_kg is None:
            raise ValueError("price_rs_kg is required when current_price_source is manual")

        if self.current_price_source == "system" and self.price_rs_kg is not None:
            raise ValueError("price_rs_kg must be omitted when current_price_source is system")

        return self
