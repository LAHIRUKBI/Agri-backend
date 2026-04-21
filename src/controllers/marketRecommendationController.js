const axios = require("axios");
const districtMarketMap = require("../utils/districtMarketMap");

const ML_API_URL = process.env.ML_API_URL || "http://127.0.0.1:8000";
const CLOSE_UP_PROBABILITY_DELTA = 0.03;

const toMarketResult = (result) => ({
  market: result.market,
  prediction: result.prediction,
  probabilities: result.probabilities,
  up_probability: result.up_probability,
  down_probability: result.down_probability,
  current_price: result.current_price,
  source_type: result.source_type,
  history_basis: result.history_basis,
  is_market_specific: result.is_market_specific,
  fallback_used: result.fallback_used,
  comparison_quality: result.comparison_quality,
  reliable_for_comparison: result.reliable_for_comparison,
  current_price_rs_kg: result.current_price_rs_kg,
  reference_price_rs_kg: result.reference_price_rs_kg,
  input_price_rs_kg: result.input_price_rs_kg,
  meta: result.meta,
});

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
        const normalizedMarket = String(market).trim().toLowerCase();
        const payload = {
          crop: normalizedCrop,
          district: normalizedMarket,
          market: normalizedMarket,
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
        const meta = data.meta || {};
        const sourceType =
          data.source_type || meta.source_type || meta.history_basis || "unknown";
        const historyBasis = data.history_basis || meta.history_basis || sourceType;
        const isMarketSpecific = Boolean(
          data.is_market_specific ?? meta.is_market_specific
        );
        const fallbackUsed = Boolean(data.fallback_used ?? meta.fallback_used);
        const reliableForComparison = sourceType === "exact_market" && !fallbackUsed;
        const marketPrice = Number(meta.latest_market_price_rs_kg);
        const historyPrice = Number(meta.latest_history_price_rs_kg);
        const referencePrice = Number.isFinite(marketPrice)
          ? marketPrice
          : Number.isFinite(historyPrice)
            ? historyPrice
            : numericPrice;

        comparisonResults.push({
          market: normalizedMarket,
          success: true,
          prediction: data.prediction,
          probabilities: {
            UP: upProbability,
            DOWN: downProbability,
          },
          up_probability: upProbability,
          down_probability: downProbability,
          current_price: referencePrice,
          source_type: sourceType,
          history_basis: historyBasis,
          is_market_specific: isMarketSpecific,
          fallback_used: fallbackUsed,
          comparison_quality: isMarketSpecific ? "market_specific" : "weak_fallback",
          reliable_for_comparison: reliableForComparison,
          current_price_rs_kg: referencePrice,
          reference_price_rs_kg: referencePrice,
          input_price_rs_kg: numericPrice,
          inference_district: payload.district,
          requested_district: normalizedDistrict,
          meta,
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

    const exactMarketResults = successfulResults.filter(
      (item) => item.reliable_for_comparison
    );
    const marketSpecificResults = successfulResults.filter(
      (item) => item.is_market_specific
    );
    const bestMarketCandidates =
      exactMarketResults.length > 0
        ? exactMarketResults
        : marketSpecificResults.length > 0
          ? marketSpecificResults
          : successfulResults;

    const bestPredictedMarket = bestMarketCandidates.reduce((best, current) => {
      return current.up_probability > best.up_probability ? current : best;
    });
    const sortedCandidates = [...bestMarketCandidates].sort(
      (a, b) => b.up_probability - a.up_probability
    );
    const runnerUp = sortedCandidates[1] || null;
    const probabilityDelta = runnerUp
      ? bestPredictedMarket.up_probability - runnerUp.up_probability
      : null;
    const isCloseCall =
      probabilityDelta != null && probabilityDelta < CLOSE_UP_PROBABILITY_DELTA;
    const comparisonStrength =
      exactMarketResults.length > 0 && !isCloseCall ? "strong" : "weak";
    const comparisonNote =
      exactMarketResults.length === 0
        ? marketSpecificResults.length > 0
          ? "No mapped market had exact district-market history; recommendation uses market-specific fallback history."
          : "No mapped market had market-specific history; recommendation is broad fallback-based."
        : isCloseCall
          ? "Top market probabilities are very close; avoid treating the best market as a decisive winner."
          : null;
    const frontendComparisons = successfulResults.map((item) => ({
      ...toMarketResult(item),
      excluded_from_best_market:
        bestMarketCandidates.length > 0 && !bestMarketCandidates.includes(item),
    }));

    return res.status(200).json({
      success: true,
      input: {
        crop: normalizedCrop,
        district: normalizedDistrict,
        price_rs_kg: numericPrice,
        horizon: numericHorizon,
      },
      nearest_market: toMarketResult(nearestMarket),
      best_market: toMarketResult(bestPredictedMarket),
      best_predicted_market: toMarketResult(bestPredictedMarket),
      comparison_strength: comparisonStrength,
      comparison_note: comparisonNote,
      is_close_call: isCloseCall,
      probability_delta: probabilityDelta,
      comparisons: frontendComparisons,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Market recommendation failed",
      error: error.response?.data || error.message,
    });
  }
};
