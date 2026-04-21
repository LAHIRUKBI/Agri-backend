const axios = require("axios");
const districtMarketMap = require("../utils/districtMarketMap");

const ML_API_URL = process.env.ML_API_URL || "http://127.0.0.1:8000";

exports.recommendBestMarket = async (req, res) => {
  try {
    const { crop, district, price_rs_kg, horizon } = req.body;

    if (!crop || !district || price_rs_kg == null) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: crop, district, price_rs_kg",
      });
    }

    const normalizedCrop = String(crop).trim().toLowerCase();
    const normalizedDistrict = String(district).trim().toLowerCase();
    const numericPrice = Number(price_rs_kg);
    const numericHorizon = horizon ? Number(horizon) : 1;

    if (numericPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "price_rs_kg must be greater than 0",
      });
    }

    if (![1, 2, 3, 4].includes(numericHorizon)) {
      return res.status(400).json({
        success: false,
        message: "horizon must be 1, 2, 3, or 4",
      });
    }

    const mappedMarkets = districtMarketMap[normalizedDistrict];

    if (!mappedMarkets || mappedMarkets.length === 0) {
      return res.status(404).json({
        success: false,
        message: `No mapped markets found for district: ${normalizedDistrict}`,
      });
    }

    const comparisonResults = [];

    for (const market of mappedMarkets) {
      try {
        const payload = {
          crop: normalizedCrop,
          district: normalizedDistrict,
          market,
          price_rs_kg: numericPrice,
          horizon: numericHorizon,
        };

        const response = await axios.post(`${ML_API_URL}/predict`, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        });

        const data = response.data;

        if (data.error) {
          comparisonResults.push({
            market,
            success: false,
            error: data.error,
          });
          continue;
        }

        const upProbability = Number(data?.probabilities?.UP ?? 0);
        const downProbability = Number(data?.probabilities?.DOWN ?? 0);

        comparisonResults.push({
          market,
          success: true,
          prediction: data.prediction,
          up_probability: upProbability,
          down_probability: downProbability,
          meta: data.meta || null,
        });
      } catch (error) {
        comparisonResults.push({
          market,
          success: false,
          error: error.response?.data || error.message,
        });
      }
    }

    const successfulResults = comparisonResults.filter((item) => item.success);

    if (successfulResults.length === 0) {
      return res.status(500).json({
        success: false,
        message: "Could not generate market recommendation",
        comparisons: comparisonResults,
      });
    }

    const nearestMappedMarket = mappedMarkets[0];

    const nearestMarket =
      successfulResults.find((item) => item.market === nearestMappedMarket) ||
      successfulResults[0];

    const bestPredictedMarket = successfulResults.reduce((best, current) => {
      return current.up_probability > best.up_probability ? current : best;
    });

    return res.status(200).json({
      success: true,
      input: {
        crop: normalizedCrop,
        district: normalizedDistrict,
        price_rs_kg: numericPrice,
        horizon: numericHorizon,
      },
      nearest_market: {
        market: nearestMarket.market,
        prediction: nearestMarket.prediction,
        up_probability: nearestMarket.up_probability,
        down_probability: nearestMarket.down_probability,
      },
      best_predicted_market: {
        market: bestPredictedMarket.market,
        prediction: bestPredictedMarket.prediction,
        up_probability: bestPredictedMarket.up_probability,
        down_probability: bestPredictedMarket.down_probability,
      },
      comparisons: successfulResults,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Market recommendation failed",
      error: error.response?.data || error.message,
    });
  }
};