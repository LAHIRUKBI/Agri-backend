const axios = require("axios");
const districtMarketMap = require("../utils/districtMarketMap");
const groqInsightGenerator = require("../utils/groqInsightGenerator");
const weatherForecastService = require("../services/weatherForecastService");
const {
  buildMarketOutlook,
  getConfidenceStrength,
} = require("../services/marketOutlookService");
const {
  buildPriceRecommendationDecision,
} = require("../services/priceRecommendationPolicy");

const ML_API_URL = process.env.ML_API_URL || "http://127.0.0.1:8000";
const CLOSE_UP_PROBABILITY_DELTA = 0.03;
const CLOSE_PRICE_DIFFERENCE_PCT = 0.02;
const MARKET_TREND_BASIS = "predicted_price_vs_latest_market_price";
const MARKET_CONTEXT_SIGNAL_BASIS =
  "predicted_price_vs_latest_observed_market_price";
const DIRECTION_MODEL_SIGNAL_NOTE =
  "Experimental direction-model signal only; it does not authorize a selling action.";

const normalizeLocationName = (value) =>
  typeof value === "string"
    ? value.trim().toLowerCase().replace(/\s+/g, " ")
    : "";

const resolveFarmerDistrict = ({ farmerDistrict, legacyDistrict }) => {
  const normalizedFarmerDistrict = normalizeLocationName(farmerDistrict);
  const normalizedLegacyDistrict = normalizeLocationName(legacyDistrict);

  if (
    normalizedFarmerDistrict &&
    normalizedLegacyDistrict &&
    normalizedFarmerDistrict !== normalizedLegacyDistrict
  ) {
    return {
      error: {
        code: "FARMER_DISTRICT_CONFLICT",
        message:
          "farmer_district and legacy district must identify the same administrative district when both are supplied",
      },
    };
  }

  const value = normalizedFarmerDistrict || normalizedLegacyDistrict;

  if (!value) {
    return {
      error: {
        code: "FARMER_DISTRICT_REQUIRED",
        message:
          "farmer_district is required (legacy district is temporarily accepted as an alias)",
      },
    };
  }

  if (!Object.prototype.hasOwnProperty.call(districtMarketMap, value)) {
    return {
      error: {
        code: "INVALID_FARMER_DISTRICT",
        message: `Unsupported farmer_district: ${value}`,
        valid_farmer_districts: Object.keys(districtMarketMap),
      },
    };
  }

  return { value };
};

const toMarketOption = (market) => ({
  value: market,
  label: market.charAt(0).toUpperCase() + market.slice(1),
});

const buildRun001MarketPayload = ({
  crop,
  candidateMarket,
  currentPriceSource,
  horizon,
  priceRsKg,
}) => {
  const normalizedCandidateMarket = normalizeLocationName(candidateMarket);
  // run_001 was trained on datasets where district == market.
  // This is a legacy model-compatibility field and does not represent
  // the farmer's administrative district.
  const payload = {
    crop,
    district: normalizedCandidateMarket,
    market: normalizedCandidateMarket,
    current_price_source: currentPriceSource,
    horizon,
  };

  if (currentPriceSource === "manual") {
    payload.price_rs_kg = priceRsKg;
  }

  return payload;
};

const toPublicRun001Meta = (meta = {}) => {
  const {
    requested_district: _internalCompatibilityDistrict,
    district_rows_available: _internalCompatibilityDistrictRows,
    ...publicMeta
  } = meta;

  return publicMeta;
};

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
  const strength = getConfidenceStrength(probability);
  return strength.charAt(0) + strength.slice(1).toLowerCase();
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

const unavailableCanonicalDecision = buildPriceRecommendationDecision({
  currentPrice: null,
  predictedPrice: null,
  classifierPrediction: null,
  upProbability: null,
  downProbability: null,
  contextQuality: "unavailable",
});

const unavailablePriceInterpretation = {
  ...getMarketTrend(null, null),
  ...unavailableCanonicalDecision,
  farmer_decision: unavailableCanonicalDecision.action_decision,
  farmer_decision_basis: unavailableCanonicalDecision.action_policy,
  farmer_decision_message:
    unavailableCanonicalDecision.action_decision_message,
  farmer_price_change_rs: null,
  farmer_price_change_pct: null,
  farmer_outcome_signal: {
    direction: unavailableCanonicalDecision.action_decision,
    basis: unavailableCanonicalDecision.action_policy,
    change_rs_per_kg: null,
    change_pct: null,
    message: unavailableCanonicalDecision.action_decision_message,
  },
};

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

const getRecommendedMarketSelection = ({ primaryMappedMarket }) => {
  return {
    recommendedMarket: primaryMappedMarket,
    recommendationBasis: "primary_mapped_market_persistence_policy",
  };
};

const toMarketResult = (result) => ({
  market: result.market,
  farmer_district: result.farmer_district,
  // Deprecated response alias retained for clients that already read it.
  requested_district: result.requested_district,
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
  current_price_source: result.current_price_source || "manual",
  resolved_current_price_rs_kg:
    result.resolved_current_price_rs_kg ?? result.input_price_rs_kg ?? null,
  resolved_current_price_at: result.resolved_current_price_at ?? null,
  resolved_current_price_age_days:
    result.resolved_current_price_age_days ?? null,
  resolved_current_price_quality:
    result.resolved_current_price_quality || "unavailable",
  model_input_price_rs_kg: result.model_input_price_rs_kg ?? null,
  persistence_next_price_rs_kg:
    result.persistence_next_price_rs_kg ?? null,
  model_run_id: result.model_run_id || "run_001",
  model_role: result.model_role || "experimental_secondary",
  model_estimate_experimental:
    result.model_estimate_experimental !== false,
  market_outlook: result.market_outlook || null,
  context_quality: result.context_quality || "unavailable",
  weather_missing: Boolean(result.weather_missing),
  inflation_missing: Boolean(result.inflation_missing),
  action_decision:
    result.action_decision || unavailableCanonicalDecision.action_decision,
  action_policy:
    result.action_policy || unavailableCanonicalDecision.action_policy,
  action_authorized: Boolean(result.action_authorized),
  action_decision_message:
    result.action_decision_message ||
    unavailableCanonicalDecision.action_decision_message,
  action_reason_codes:
    result.action_reason_codes ||
    unavailableCanonicalDecision.action_reason_codes,
  market_trend: result.market_trend || "UNAVAILABLE",
  market_trend_message:
    result.market_trend_message ||
    unavailablePriceInterpretation.market_trend_message,
  market_trend_basis: result.market_trend_basis || MARKET_TREND_BASIS,
  farmer_decision:
    result.action_decision || result.farmer_decision || "UNCERTAIN",
  farmer_decision_message:
    result.action_decision_message ||
    result.farmer_decision_message ||
    unavailablePriceInterpretation.farmer_decision_message,
  farmer_decision_basis:
    result.action_policy ||
    result.farmer_decision_basis ||
    unavailableCanonicalDecision.action_policy,
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
    unavailablePriceInterpretation.farmer_outcome_signal,
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

exports.getMarketOptions = (req, res) => {
  const resolution = resolveFarmerDistrict({
    farmerDistrict: req.query?.farmer_district,
  });

  if (resolution.error) {
    return res.status(400).json({
      success: false,
      ...resolution.error,
    });
  }

  const farmerDistrict = resolution.value;

  return res.status(200).json({
    success: true,
    farmer_district: farmerDistrict,
    available_markets: districtMarketMap[farmerDistrict].map(toMarketOption),
  });
};

exports.recommendBestMarket = async (req, res) => {
  try {
    const {
      crop,
      farmer_district,
      district,
      price_rs_kg,
      current_price_source,
      horizon,
    } = req.body;
    const normalizedPriceSource = String(
      current_price_source || (price_rs_kg != null ? "manual" : "")
    )
      .trim()
      .toLowerCase();

    if (!crop || !["manual", "system"].includes(normalizedPriceSource)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_PRICE_SOURCE",
        message:
          "crop and current_price_source (manual or system) are required",
      });
    }

    const districtResolution = resolveFarmerDistrict({
      farmerDistrict: farmer_district,
      legacyDistrict: district,
    });

    if (districtResolution.error) {
      return res.status(400).json({
        success: false,
        ...districtResolution.error,
      });
    }

    const farmerDistrict = districtResolution.value;

    if (normalizedPriceSource === "manual" && price_rs_kg == null) {
      return res.status(400).json({
        success: false,
        code: "MANUAL_PRICE_REQUIRED",
        message: "price_rs_kg is required for manual current-price mode",
      });
    }

    if (normalizedPriceSource === "system" && price_rs_kg != null) {
      return res.status(400).json({
        success: false,
        code: "SYSTEM_PRICE_MUST_BE_OMITTED",
        message: "price_rs_kg must be omitted for system current-price mode",
      });
    }

    const normalizedCrop = String(crop).trim().toLowerCase();
    const numericPrice =
      normalizedPriceSource === "manual" ? Number(price_rs_kg) : null;
    const numericHorizon = horizon == null ? 1 : Number(horizon);

    if (
      normalizedPriceSource === "manual" &&
      (!Number.isFinite(numericPrice) || numericPrice <= 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "price_rs_kg must be greater than 0",
      });
    }

    if (numericHorizon !== 1) {
      return res.status(400).json({
        success: false,
        code: "UNSUPPORTED_HORIZON",
        message: "Only horizon=1 (the next market period) is supported",
      });
    }

    const mappedMarkets = districtMarketMap[farmerDistrict];

    const comparisonResults = [];

    for (const market of mappedMarkets) {
      try {
        const normalizedMarket = String(market).trim().toLowerCase();
        const payload = buildRun001MarketPayload({
          crop: normalizedCrop,
          candidateMarket: normalizedMarket,
          currentPriceSource: normalizedPriceSource,
          horizon: numericHorizon,
          priceRsKg: numericPrice,
        });

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
        const publicMeta = toPublicRun001Meta(meta);
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
        const resolvedCurrentPrice = toFiniteNumber(
          data.resolved_current_price_rs_kg ??
            meta.resolved_current_price_rs_kg
        );
        const currentPriceForDecision =
          resolvedCurrentPrice ?? numericPrice;
        const referencePrice = Number.isFinite(marketPrice)
          ? marketPrice
          : Number.isFinite(historyPrice)
            ? historyPrice
            : currentPriceForDecision;
        const predictedPrice = toFiniteNumber(data.predicted_price_rs_kg);
        const directionModelSignal = buildDirectionModelSignal({
          prediction: data.prediction,
          upProbability,
          downProbability,
        });
        const canonicalDecision = buildPriceRecommendationDecision({
          currentPrice: currentPriceForDecision,
          predictedPrice,
          classifierPrediction: data.prediction,
          upProbability,
          downProbability,
          contextQuality: data.context_quality || meta.context_quality,
        });
        // market_outlook interprets experimental model evidence only.
        // action_decision remains the separate canonical price action and is
        // never derived from this descriptive outlook.
        const marketOutlook = buildMarketOutlook({
          priceSignal: canonicalDecision.model_implied_direction,
          directionSignal: data.prediction,
          confidence: directionModelSignal.confidence_probability,
        });
        const farmerDifference = getPriceDifference(
          predictedPrice,
          currentPriceForDecision
        );
        const priceInterpretation = {
          ...getMarketTrend(predictedPrice, referencePrice),
          ...canonicalDecision,
          farmer_decision: canonicalDecision.action_decision,
          farmer_decision_basis: canonicalDecision.action_policy,
          farmer_decision_message:
            canonicalDecision.action_decision_message,
          farmer_price_change_rs: farmerDifference.changeRs,
          farmer_price_change_pct: farmerDifference.changePct,
        };
        const farmerOutcomeSignal = {
          direction: canonicalDecision.action_decision,
          basis: canonicalDecision.action_policy,
          change_rs_per_kg: farmerDifference.changeRs,
          change_pct: farmerDifference.changePct,
          message: canonicalDecision.action_decision_message,
        };
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
          current_price: currentPriceForDecision,
          source_type: sourceType,
          history_basis: historyBasis,
          is_market_specific: isMarketSpecific,
          fallback_used: fallbackUsed,
          comparison_quality: isMarketSpecific ? "market_specific" : "weak_fallback",
          reliable_for_comparison: reliableForComparison,
          current_price_rs_kg: currentPriceForDecision,
          reference_price_rs_kg: referencePrice,
          input_price_rs_kg: currentPriceForDecision,
          predicted_price_rs_kg: predictedPrice,
          price_prediction_source: data.price_prediction_source || "unavailable",
          price_model_metrics: data.price_model_metrics || null,
          current_price_source: normalizedPriceSource,
          resolved_current_price_rs_kg: currentPriceForDecision,
          resolved_current_price_at:
            data.resolved_current_price_at ??
            meta.resolved_current_price_at ??
            null,
          resolved_current_price_age_days:
            data.resolved_current_price_age_days ??
            meta.resolved_current_price_age_days ??
            null,
          resolved_current_price_quality:
            data.resolved_current_price_quality ||
            meta.resolved_current_price_quality ||
            "unavailable",
          model_input_price_rs_kg:
            toFiniteNumber(data.model_input_price_rs_kg) ??
            currentPriceForDecision,
          persistence_next_price_rs_kg:
            toFiniteNumber(data.persistence_next_price_rs_kg) ??
            canonicalDecision.persistence_next_price_rs_kg,
          model_run_id: data.model_run_id || "run_001",
          model_role: data.model_role || "experimental_secondary",
          model_estimate_experimental: true,
          market_outlook: marketOutlook,
          context_quality:
            data.context_quality || meta.context_quality || "unavailable",
          weather_missing: Boolean(
            data.weather_missing ?? meta.weather_missing
          ),
          inflation_missing: Boolean(
            data.inflation_missing ?? meta.inflation_missing
          ),
          ...priceInterpretation,
          direction_model_signal: directionModelSignal,
          farmer_outcome_signal: farmerOutcomeSignal,
          market_context_signal: marketContextSignal,
          farmer_district: farmerDistrict,
          // Deprecated public response alias. Use farmer_district in new code.
          requested_district: farmerDistrict,
          meta: publicMeta,
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

    const firstCandidateMarket = mappedMarkets[0];

    const primaryMappedMarket =
      successfulResults.find((item) => item.market === firstCandidateMarket) ||
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
    const bestFarmerReturnMarket = getBestFarmerReturnMarket(
      successfulResults,
      bestPredictedMarket
    );
    const { recommendedMarket, recommendationBasis } =
      getRecommendedMarketSelection({
        primaryMappedMarket,
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
          ? "No mapped market had exact market history; recommendation uses market-specific fallback history."
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
      farmer_district: farmerDistrict,
      // Deprecated response alias retained during the public-field migration.
      district: farmerDistrict,
      current_price_source: normalizedPriceSource,
      horizon: numericHorizon,
    };
    if (normalizedPriceSource === "manual") {
      input.price_rs_kg = numericPrice;
    }
    const primaryMappedMarketResult = toMarketResult(primaryMappedMarket);
    const bestPredictedMarketResult = toMarketResult(bestPredictedMarket);
    const bestFarmerReturnMarketResult = toMarketResult(bestFarmerReturnMarket);
    const recommendedMarketResult = toMarketResult(recommendedMarket);
    let weatherContext = null;
    let weatherForecast = null;
    try {
      weatherContext = await weatherForecastService.getSevenDayRainfallContext(
        farmerDistrict
      );
      if (weatherContext) {
        const {
          weather_forecast: structuredWeatherForecast,
          ...rainfallSummaryContext
        } = weatherContext;
        weatherForecast = structuredWeatherForecast ?? null;
        weatherContext = rainfallSummaryContext;
      }
    } catch (error) {
      weatherContext = null;
      weatherForecast = null;
    }
    const aiInsights = await groqInsightGenerator.generateGroqInsights({
      input,
      primaryMappedMarket: primaryMappedMarketResult,
      bestPredictedMarket: bestPredictedMarketResult,
      recommendedMarket: recommendedMarketResult,
      actionDecision: recommendedMarketResult.action_decision,
      weatherContext,
      comparisons: frontendComparisons,
      comparisonStrength,
      comparisonNote,
      isCloseCall,
      probabilityDelta,
    });

    return res.status(200).json({
      success: true,
      farmer_district: farmerDistrict,
      available_markets: [...mappedMarkets],
      input,
      primary_mapped_market: primaryMappedMarketResult,
      best_market: bestPredictedMarketResult,
      best_predicted_market: bestPredictedMarketResult,
      best_farmer_return_market: bestFarmerReturnMarketResult,
      recommended_market: recommendedMarketResult,
      market_outlook: recommendedMarketResult.market_outlook,
      action_decision: recommendedMarketResult.action_decision,
      action_policy: recommendedMarketResult.action_policy,
      action_authorized: recommendedMarketResult.action_authorized,
      action_decision_message:
        recommendedMarketResult.action_decision_message,
      action_reason_codes: recommendedMarketResult.action_reason_codes,
      persistence_next_price_rs_kg:
        recommendedMarketResult.persistence_next_price_rs_kg,
      recommendation_basis: recommendationBasis,
      comparison_strength: comparisonStrength,
      comparison_note: comparisonNote,
      is_close_call: isCloseCall,
      probability_delta: probabilityDelta,
      comparisons: frontendComparisons,
      ai_insights: aiInsights,
      weather_forecast: weatherForecast,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Market recommendation failed",
      error: error.response?.data || error.message,
    });
  }
};
