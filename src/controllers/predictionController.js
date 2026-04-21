const axios = require("axios");

const ML_API_URL = process.env.ML_API_URL || "http://127.0.0.1:8000";

exports.predictPriceDirection = async (req, res) => {
  try {
    const {
      crop,
      district,
      market,
      price_rs_kg,
      horizon,
    } = req.body;

    if (!crop || !district || !market || price_rs_kg == null) {
      return res.status(400).json({
        success: false,
        message: "Missing required prediction fields",
      });
    }

    if (Number(price_rs_kg) <= 0) {
      return res.status(400).json({
        success: false,
        message: "price_rs_kg must be greater than 0",
      });
    }

    if (horizon != null && ![1, 2, 3, 4].includes(Number(horizon))) {
      return res.status(400).json({
        success: false,
        message: "horizon must be 1, 2, 3, or 4",
      });
    }

    const payload = {
      crop,
      district,
      market,
      price_rs_kg: Number(price_rs_kg),
      horizon: horizon ? Number(horizon) : 1,
    };

    const response = await axios.post(`${ML_API_URL}/predict`, payload, {
      headers: { "Content-Type": "application/json" },
      timeout: 15000,
    });

    return res.status(200).json({
      success: true,
      source: "fastapi",
      data: response.data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Prediction request failed",
      error: error.response?.data || error.message,
    });
  }
};