const ACTION_DECISIONS = Object.freeze({
  SELL_NOW: "SELL_NOW",
  WAIT: "WAIT",
  UNCERTAIN: "UNCERTAIN",
});

const ACTION_POLICY = "rs5_price_direction_v1";
const MIN_ACTIONABLE_PRICE_DIFFERENCE_RS = 5;
// Currency values remain unrounded. This epsilon only absorbs binary
// floating-point noise at the exact +/- Rs.5/kg decision boundaries.
const PRICE_DIFFERENCE_EPSILON_RS = 1e-9;

const toFiniteNumber = (value) => {
  if (
    value == null ||
    typeof value === "boolean" ||
    (typeof value === "string" && value.trim() === "") ||
    !["number", "string"].includes(typeof value)
  ) {
    return null;
  }

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

  const differenceRs = predictedPrice - currentPrice;
  if (
    differenceRs >=
    MIN_ACTIONABLE_PRICE_DIFFERENCE_RS - PRICE_DIFFERENCE_EPSILON_RS
  ) {
    return "UP";
  }
  if (
    differenceRs <=
    -MIN_ACTIONABLE_PRICE_DIFFERENCE_RS + PRICE_DIFFERENCE_EPSILON_RS
  ) {
    return "DOWN";
  }
  return "STABLE";
};

const buildPriceRecommendationDecision = ({
  currentPrice,
  predictedPrice,
}) => {
  const safeCurrentPrice = toFiniteNumber(currentPrice);
  const safePredictedPrice = toFiniteNumber(predictedPrice);
  const currentPriceAvailable = safeCurrentPrice != null && safeCurrentPrice > 0;
  const predictedPriceAvailable = safePredictedPrice != null;
  const modelDirection = getModelDirection(
    safePredictedPrice,
    safeCurrentPrice
  );
  const reasonCodes = [];

  if (!currentPriceAvailable) {
    reasonCodes.push("CURRENT_PRICE_UNAVAILABLE");
  }

  if (!predictedPriceAvailable) {
    reasonCodes.push("MODEL_ESTIMATE_UNAVAILABLE");
  }

  const baseDecision = {
    action_policy: ACTION_POLICY,
    persistence_next_price_rs_kg: currentPriceAvailable
      ? safeCurrentPrice
      : null,
    model_implied_direction: modelDirection,
    model_estimate_experimental: true,
  };

  if (!currentPriceAvailable || !predictedPriceAvailable) {
    return {
      ...baseDecision,
      action_decision: ACTION_DECISIONS.UNCERTAIN,
      action_authorized: false,
      action_decision_message:
        "Selling guidance is uncertain because the current price or predicted next-period price is unavailable.",
      action_reason_codes: reasonCodes,
    };
  }

  const priceDifferenceRs = safePredictedPrice - safeCurrentPrice;

  if (
    priceDifferenceRs >=
    MIN_ACTIONABLE_PRICE_DIFFERENCE_RS - PRICE_DIFFERENCE_EPSILON_RS
  ) {
    return {
      ...baseDecision,
      action_decision: ACTION_DECISIONS.WAIT,
      action_authorized: true,
      action_decision_message:
        "The predicted next-period price is at least Rs.5/kg higher than the current selling price, so waiting may improve the selling price.",
      action_reason_codes: [
        "PREDICTED_PRICE_INCREASE_AT_LEAST_RS5",
      ],
    };
  }

  if (
    priceDifferenceRs <=
    -MIN_ACTIONABLE_PRICE_DIFFERENCE_RS + PRICE_DIFFERENCE_EPSILON_RS
  ) {
    return {
      ...baseDecision,
      action_decision: ACTION_DECISIONS.SELL_NOW,
      action_authorized: true,
      action_decision_message:
        "The predicted next-period price is at least Rs.5/kg lower than the current selling price, so selling now may avoid the expected decline.",
      action_reason_codes: [
        "PREDICTED_PRICE_DECREASE_AT_LEAST_RS5",
      ],
    };
  }

  return {
    ...baseDecision,
    action_decision: ACTION_DECISIONS.UNCERTAIN,
    action_authorized: false,
    action_decision_message:
      "The predicted next-period price differs from the current selling price by less than Rs.5/kg, so the timing advantage is uncertain.",
    action_reason_codes: ["PRICE_DIFFERENCE_BELOW_RS5_THRESHOLD"],
  };
};

module.exports = {
  ACTION_DECISIONS,
  ACTION_POLICY,
  MIN_ACTIONABLE_PRICE_DIFFERENCE_RS,
  PRICE_DIFFERENCE_EPSILON_RS,
  buildPriceRecommendationDecision,
};
