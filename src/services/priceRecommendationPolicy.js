const ACTION_DECISIONS = Object.freeze({
  SELL_NOW: "SELL_NOW",
  WAIT: "WAIT",
  UNCERTAIN: "UNCERTAIN",
});

const ACTION_POLICY = "persistence_primary_v1";
const SMALL_MODEL_DIFFERENCE_PCT = 0.02;

const toFiniteNumber = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const getModelDirection = (predictedPrice, currentPrice) => {
  if (
    !Number.isFinite(predictedPrice) ||
    !Number.isFinite(currentPrice) ||
    currentPrice <= 0
  ) {
    return "UNAVAILABLE";
  }

  const differenceRatio = (predictedPrice - currentPrice) / currentPrice;
  if (Math.abs(differenceRatio) < SMALL_MODEL_DIFFERENCE_PCT) return "STABLE";
  return differenceRatio > 0 ? "UP" : "DOWN";
};

const buildPriceRecommendationDecision = ({
  currentPrice,
  predictedPrice,
  classifierPrediction,
  upProbability,
  downProbability,
  contextQuality,
}) => {
  const safeCurrentPrice = toFiniteNumber(currentPrice);
  const safePredictedPrice = toFiniteNumber(predictedPrice);
  const safeUpProbability = toFiniteNumber(upProbability);
  const safeDownProbability = toFiniteNumber(downProbability);
  const normalizedClassifierPrediction = String(
    classifierPrediction || ""
  ).toUpperCase();
  const modelDirection = getModelDirection(
    safePredictedPrice,
    safeCurrentPrice
  );
  const reasonCodes = [];

  if (safeCurrentPrice == null || safeCurrentPrice <= 0) {
    reasonCodes.push("CURRENT_PRICE_UNAVAILABLE");
  }

  if (safePredictedPrice == null) {
    reasonCodes.push("MODEL_ESTIMATE_UNAVAILABLE");
  }

  if (modelDirection === "STABLE") {
    reasonCodes.push("MODEL_DIFFERENCE_SMALL");
  }

  if (
    ["UP", "DOWN"].includes(modelDirection) &&
    ["UP", "DOWN"].includes(normalizedClassifierPrediction) &&
    modelDirection !== normalizedClassifierPrediction
  ) {
    reasonCodes.push("MODEL_SIGNAL_CONFLICT");
  }

  if (safeUpProbability == null || safeDownProbability == null) {
    reasonCodes.push("MODEL_CONFIDENCE_INSUFFICIENT");
  }

  if (contextQuality && contextQuality !== "complete") {
    reasonCodes.push("MODEL_CONTEXT_INCOMPLETE");
  }

  reasonCodes.push("PERSISTENCE_NO_DIRECTIONAL_EDGE");
  reasonCodes.push("MODEL_NOT_ACTION_AUTHORIZED");

  return {
    action_decision: ACTION_DECISIONS.UNCERTAIN,
    action_policy: ACTION_POLICY,
    action_authorized: false,
    action_decision_message:
      "Timing advantage is uncertain. Compare current buyer offers, transport costs, and storage or spoilage risk before selling.",
    action_reason_codes: [...new Set(reasonCodes)],
    persistence_next_price_rs_kg: safeCurrentPrice,
    model_implied_direction: modelDirection,
    model_estimate_experimental: true,
  };
};

module.exports = {
  ACTION_DECISIONS,
  ACTION_POLICY,
  SMALL_MODEL_DIFFERENCE_PCT,
  buildPriceRecommendationDecision,
};
