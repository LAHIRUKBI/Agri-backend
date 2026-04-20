const axios = require("axios");

const ML_API_URL = process.env.ML_API_URL || "http://127.0.0.1:8000";

exports.predictPriceDirection = async (req, res) => {
  try {
    const {
      crop,
      district,
      market,
      season,
      year,
      month,
      week_number,
      price_rs_kg,
    } = req.body;

    if (
      !crop ||
      !district ||
      !market ||
      !season ||
      year == null ||
      month == null ||
      week_number == null ||
      price_rs_kg == null
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required prediction fields",
      });
    }

    const response = await axios.post(`${ML_API_URL}/predict`, req.body, {
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