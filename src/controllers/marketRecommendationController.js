const axios = require("axios");
const districtMarketMap = require("../utils/districtMarketMap");
const { generateGroqInsights } = require("../utils/groqInsightGenerator");

const ML_API_URL = process.env.ML_API_URL || "http://127.0.0.1:8000";
const CLOSE_UP_PROBABILITY_DELTA = 0.03;
const CLOSE_PRICE_DIFFERENCE_PCT = 0.02;
const MARKET_TREND_BASIS = "predicted_price_vs_latest_market_price";
const FARMER_DECISION_BASIS = "predicted_price_vs_farmer_entered_price";
const MARKET_CONTEXT_SIGNAL_BASIS =
  "predicted_price_vs_latest_observed_market_price";
const DIRECTION_MODEL_SIGNAL_NOTE =
  "Direction model signal only; farmer outcome is calculated from predicted price and entered price.";

const toFiniteNumber = (value) => {
  if (value == null || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const roundNumber = (value) =>
  Number.isFinite(value) ? Number(value.toFixed(2)) : null;

const getPriceDifference = (predictedPrice, basePrice) => {
  if (
    !Number.isFinite(predictedPrice) ||
    !Number.isFinite(basePrice) ||
    basePrice <= 0
  ) {
    return {
      changeRs: null,
      changePct: null,
      isClose: false,
    };
  }

  const changeRs = predictedPrice - basePrice;
  const changePctRatio = changeRs / basePrice;

  return {
    changeRs: roundNumber(changeRs),
    changePct: roundNumber(changePctRatio * 100),
    isClose: Math.abs(changePctRatio) < CLOSE_PRICE_DIFFERENCE_PCT,
  };
};

const getConfidenceLabel = (probability) => {
  const safeProbability = Number.isFinite(probability) ? probability : 0;

  if (safeProbability < 0.6) {
    return "Low";
  }

  if (safeProbability < 0.75) {
    return "Moderate";
  }

  return "Strong";
};

const buildDirectionModelSignal = ({
  prediction,
  upProbability,
  downProbability,
}) => {
  const safeUpProbability = Number.isFinite(upProbability) ? upProbability : 0;
  const safeDownProbability = Number.isFinite(downProbability)
    ? downProbability
    : 0;
  const confidenceProbability =
    prediction === "DOWN" ? safeDownProbability : safeUpProbability;

  return {
    prediction,
    up_probability: safeUpProbability,
    down_probability: safeDownProbability,
    confidence_probability: confidenceProbability,
    confidence_label: getConfidenceLabel(confidenceProbability),
    note: DIRECTION_MODEL_SIGNAL_NOTE,
  };
};

const getMarketTrend = (predictedPrice, currentMarketPrice) => {
  if (
    !Number.isFinite(predictedPrice) ||
    !Number.isFinite(currentMarketPrice) ||
    currentMarketPrice <= 0
  ) {
    return {
      market_trend: "UNAVAILABLE",
      market_trend_basis: MARKET_TREND_BASIS,
      market_trend_message:
        "Market trend is unavailable because the model estimate or latest observed market price is missing.",
      market_price_change_rs: null,
      market_price_change_pct: null,
    };
  }

  const difference = getPriceDifference(predictedPrice, currentMarketPrice);

  if (difference.isClose) {
    return {
      market_trend: "STABLE",
      market_trend_basis: MARKET_TREND_BASIS,
      market_trend_message:
        "The model estimate is close to the latest observed market price, so the market trend may be stable.",
      market_price_change_rs: difference.changeRs,
      market_price_change_pct: difference.changePct,
    };
  }

  if (predictedPrice > currentMarketPrice) {
    return {
      market_trend: "UP",
      market_trend_basis: MARKET_TREND_BASIS,
      market_trend_message:
        "The model estimate is higher than the latest observed market price, suggesting a possible upward market trend.",
      market_price_change_rs: difference.changeRs,
      market_price_change_pct: difference.changePct,
    };
  }

  return {
    market_trend: "DOWN",
    market_trend_basis: MARKET_TREND_BASIS,
    market_trend_message:
      "The model estimate is lower than the latest observed market price.",
    market_price_change_rs: difference.changeRs,
    market_price_change_pct: difference.changePct,
  };
};

const buildMarketContextSignal = (predictedPrice, currentMarketPrice) => {
  const marketTrend = getMarketTrend(predictedPrice, currentMarketPrice);

  return {
    trend: marketTrend.market_trend,
    basis: MARKET_CONTEXT_SIGNAL_BASIS,
    change_rs_per_kg: marketTrend.market_price_change_rs,
    change_pct: marketTrend.market_price_change_pct,
    message: marketTrend.market_trend_message,
  };
};

const getFarmerDecision = (predictedPrice, inputPrice) => {
  if (
    !Number.isFinite(predictedPrice) ||
    !Number.isFinite(inputPrice) ||
    inputPrice <= 0
  ) {
    return {
      farmer_decision: "UNAVAILABLE",
      farmer_decision_basis: FARMER_DECISION_BASIS,
      farmer_decision_message:
        "Farmer decision guidance is unavailable because the model estimate or entered current price is missing.",
      farmer_price_change_rs: null,
      farmer_price_change_pct: null,
    };
  }

  const difference = getPriceDifference(predictedPrice, inputPrice);

  if (difference.isClose) {
    return {
      farmer_decision: "SMALL_DIFFERENCE",
      farmer_decision_basis: FARMER_DECISION_BASIS,
      farmer_decision_message:
        "The model estimate is close to your entered current price, so the difference may be small.",
      farmer_price_change_rs: difference.changeRs,
      farmer_price_change_pct: difference.changePct,
    };
  }

  if (predictedPrice > inputPrice) {
    return {
      farmer_decision: "WAIT",
      farmer_decision_basis: FARMER_DECISION_BASIS,
      farmer_decision_message:
        "Waiting may improve your return compared with your entered current price.",
      farmer_price_change_rs: difference.changeRs,
      farmer_price_change_pct: difference.changePct,
    };
  }

  return {
    farmer_decision: "SELL_NOW",
    farmer_decision_basis: FARMER_DECISION_BASIS,
    farmer_decision_message:
      "Selling now may be safer because the model estimate is lower than your entered current price.",
    farmer_price_change_rs: difference.changeRs,
    farmer_price_change_pct: difference.changePct,
  };
};

const buildFarmerOutcomeSignal = (predictedPrice, inputPrice) => {
  if (
    !Number.isFinite(predictedPrice) ||
    !Number.isFinite(inputPrice) ||
    inputPrice <= 0
  ) {
    return {
      direction: "UNAVAILABLE",
      basis: FARMER_DECISION_BASIS,
      change_rs_per_kg: null,
      change_pct: null,
      message: "Price estimate unavailable.",
    };
  }

  const difference = getPriceDifference(predictedPrice, inputPrice);

  if (difference.isClose) {
    return {
      direction: "SMALL_DIFFERENCE",
      basis: FARMER_DECISION_BASIS,
      change_rs_per_kg: difference.changeRs,
      change_pct: difference.changePct,
      message: "The difference is small; choose the practical option.",
    };
  }

  if (predictedPrice > inputPrice) {
    return {
      direction: "GAIN",
      basis: FARMER_DECISION_BASIS,
      change_rs_per_kg: difference.changeRs,
      change_pct: difference.changePct,
      message:
        "Waiting may improve your return compared with your entered price.",
    };
  }

  return {
    direction: "LOSS",
    basis: FARMER_DECISION_BASIS,
    change_rs_per_kg: difference.changeRs,
    change_pct: difference.changePct,
    message: "Selling now may be safer based on this estimate.",
  };
};

const buildPriceInterpretation = ({
  predictedPrice,
  currentMarketPrice,
  inputPrice,
}) => ({
  ...getMarketTrend(predictedPrice, currentMarketPrice),
  ...getFarmerDecision(predictedPrice, inputPrice),
});

const unavailablePriceInterpretation = buildPriceInterpretation({
  predictedPrice: null,
  currentMarketPrice: null,
  inputPrice: null,
});

const getBestFarmerReturnMarket = (markets, fallbackMarket) => {
  return (
    markets.reduce((best, current) => {
      if (!Number.isFinite(current.predicted_price_rs_kg)) {
        return best;
      }

      if (
        !best ||
        current.predicted_price_rs_kg > best.predicted_price_rs_kg
      ) {
        return current;
      }

      return best;
    }, null) || fallbackMarket
  );
};

const getRecommendedMarketSelection = ({
  nearestMarket,
  bestFarmerReturnMarket,
  bestPredictedMarket,
  hasPredictedPrice,
}) => {
  if (!hasPredictedPrice) {
    return {
      recommendedMarket: bestPredictedMarket,
      recommendationBasis: "direction_probability_fallback",
    };
  }

  const bestFarmerPrice = bestFarmerReturnMarket?.predicted_price_rs_kg;
  const nearestPrice = nearestMarket?.predicted_price_rs_kg;

  if (
    Number.isFinite(bestFarmerPrice) &&
    (!Number.isFinite(nearestPrice) || nearestPrice <= 0)
  ) {
    return {
      recommendedMarket: bestFarmerReturnMarket,
      recommendationBasis: "farmer_return",
    };
  }

  if (Number.isFinite(bestFarmerPrice) && Number.isFinite(nearestPrice)) {
    const priceDifferencePct = (bestFarmerPrice - nearestPrice) / nearestPrice;

    if (priceDifferencePct >= CLOSE_PRICE_DIFFERENCE_PCT) {
      return {
        recommendedMarket: bestFarmerReturnMarket,
        recommendationBasis: "farmer_return",
      };
    }
  }

  return {
    recommendedMarket: nearestMarket,
    recommendationBasis: "nearest_practical",
  };
};

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
  predicted_price_rs_kg: result.predicted_price_rs_kg ?? null,
  price_prediction_source: result.price_prediction_source || "unavailable",
  price_model_metrics: result.price_model_metrics || null,
  market_trend: result.market_trend || "UNAVAILABLE",
  market_trend_message:
    result.market_trend_message ||
    unavailablePriceInterpretation.market_trend_message,
  market_trend_basis: result.market_trend_basis || MARKET_TREND_BASIS,
  farmer_decision: result.farmer_decision || "UNAVAILABLE",
  farmer_decision_message:
    result.farmer_decision_message ||
    unavailablePriceInterpretation.farmer_decision_message,
  farmer_decision_basis:
    result.farmer_decision_basis || FARMER_DECISION_BASIS,
  market_price_change_rs: result.market_price_change_rs ?? null,
  market_price_change_pct: result.market_price_change_pct ?? null,
  farmer_price_change_rs: result.farmer_price_change_rs ?? null,
  farmer_price_change_pct: result.farmer_price_change_pct ?? null,
  direction_model_signal:
    result.direction_model_signal ||
    buildDirectionModelSignal({
      prediction: result.prediction,
      upProbability: result.up_probability,
      downProbability: result.down_probability,
    }),
  farmer_outcome_signal:
    result.farmer_outcome_signal ||
    buildFarmerOutcomeSignal(
      result.predicted_price_rs_kg,
      result.input_price_rs_kg
    ),
  market_context_signal:
    result.market_context_signal ||
    buildMarketContextSignal(
      result.predicted_price_rs_kg,
      result.reference_price_rs_kg ??
        result.current_price_rs_kg ??
        result.current_price
    ),
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
            predicted_price_rs_kg: null,
            current_price_rs_kg: null,
            input_price_rs_kg: numericPrice,
            ...unavailablePriceInterpretation,
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
        const predictedPrice = toFiniteNumber(data.predicted_price_rs_kg);
        const priceInterpretation = buildPriceInterpretation({
          predictedPrice,
          currentMarketPrice: referencePrice,
          inputPrice: numericPrice,
        });
        const directionModelSignal = buildDirectionModelSignal({
          prediction: data.prediction,
          upProbability,
          downProbability,
        });
        const farmerOutcomeSignal = buildFarmerOutcomeSignal(
          predictedPrice,
          numericPrice
        );
        const marketContextSignal = buildMarketContextSignal(
          predictedPrice,
          referencePrice
        );

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
          predicted_price_rs_kg: predictedPrice,
          price_prediction_source: data.price_prediction_source || "unavailable",
          price_model_metrics: data.price_model_metrics || null,
          ...priceInterpretation,
          direction_model_signal: directionModelSignal,
          farmer_outcome_signal: farmerOutcomeSignal,
          market_context_signal: marketContextSignal,
          inference_district: payload.district,
          requested_district: normalizedDistrict,
          meta,
        });
      } catch (error) {
        comparisonResults.push({
          market,
          success: false,
          error: error.response?.data || error.message,
          predicted_price_rs_kg: null,
          current_price_rs_kg: null,
          input_price_rs_kg: numericPrice,
          ...unavailablePriceInterpretation,
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
    const hasPredictedPrice = successfulResults.some((item) =>
      Number.isFinite(item.predicted_price_rs_kg)
    );
    const bestFarmerReturnMarket = getBestFarmerReturnMarket(
      successfulResults,
      bestPredictedMarket
    );
    const { recommendedMarket, recommendationBasis } =
      getRecommendedMarketSelection({
        nearestMarket,
        bestFarmerReturnMarket,
        bestPredictedMarket,
        hasPredictedPrice,
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
    const input = {
      crop: normalizedCrop,
      district: normalizedDistrict,
      price_rs_kg: numericPrice,
      horizon: numericHorizon,
    };
    const nearestMarketResult = toMarketResult(nearestMarket);
    const bestPredictedMarketResult = toMarketResult(bestPredictedMarket);
    const bestFarmerReturnMarketResult = toMarketResult(bestFarmerReturnMarket);
    const recommendedMarketResult = toMarketResult(recommendedMarket);
    const aiInsights = await generateGroqInsights({
      input,
      nearestMarket: nearestMarketResult,
      bestPredictedMarket: bestPredictedMarketResult,
      comparisons: frontendComparisons,
      comparisonStrength,
      comparisonNote,
      isCloseCall,
      probabilityDelta,
    });

    return res.status(200).json({
      success: true,
      input,
      nearest_market: nearestMarketResult,
      best_market: bestPredictedMarketResult,
      best_predicted_market: bestPredictedMarketResult,
      best_farmer_return_market: bestFarmerReturnMarketResult,
      recommended_market: recommendedMarketResult,
      recommendation_basis: recommendationBasis,
      comparison_strength: comparisonStrength,
      comparison_note: comparisonNote,
      is_close_call: isCloseCall,
      probability_delta: probabilityDelta,
      comparisons: frontendComparisons,
      ai_insights: aiInsights,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Market recommendation failed",
      error: error.response?.data || error.message,
    });
  }
};
