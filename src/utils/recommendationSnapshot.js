const MARKET_STRING_FIELDS = [
  "market",
  "farmer_district",
  "prediction",
  "source_type",
  "history_basis",
  "comparison_quality",
  "price_prediction_source",
  "current_price_source",
  "resolved_current_price_at",
  "resolved_current_price_quality",
  "model_run_id",
  "model_role",
  "context_quality",
  "action_decision",
  "action_policy",
  "action_decision_message",
  "market_trend",
  "market_trend_message",
  "market_trend_basis",
  "farmer_decision",
  "farmer_decision_message",
  "farmer_decision_basis",
];

const MARKET_NUMBER_FIELDS = [
  "up_probability",
  "down_probability",
  "current_price",
  "current_price_rs_kg",
  "reference_price_rs_kg",
  "input_price_rs_kg",
  "predicted_price_rs_kg",
  "resolved_current_price_rs_kg",
  "resolved_current_price_age_days",
  "model_input_price_rs_kg",
  "persistence_next_price_rs_kg",
  "market_price_change_rs",
  "market_price_change_pct",
  "farmer_price_change_rs",
  "farmer_price_change_pct",
];

const MARKET_BOOLEAN_FIELDS = [
  "is_market_specific",
  "fallback_used",
  "reliable_for_comparison",
  "model_estimate_experimental",
  "weather_missing",
  "inflation_missing",
  "action_authorized",
  "excluded_from_best_market",
];

const AI_INSIGHT_FIELDS = [
  "recommendation",
  "prediction_summary",
  "price_movement",
  "prediction_strength",
  "why_this_matters",
  "suggested_action",
];

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasOwn = (source, key) =>
  Object.prototype.hasOwnProperty.call(source, key);

const copyString = (source, target, key, { nullable = false } = {}) => {
  if (!hasOwn(source, key)) return;

  if (nullable && source[key] === null) {
    target[key] = null;
    return;
  }

  if (typeof source[key] !== "string") return;

  const value = source[key].trim();
  if (value) target[key] = value;
};

const copyNumber = (source, target, key, { nullable = true } = {}) => {
  if (!hasOwn(source, key)) return;

  if (nullable && source[key] === null) {
    target[key] = null;
    return;
  }

  if (typeof source[key] === "number" && Number.isFinite(source[key])) {
    target[key] = source[key];
  }
};

const copyBoolean = (source, target, key) => {
  if (typeof source[key] === "boolean") {
    target[key] = source[key];
  }
};

const copyFields = (
  source,
  { strings = [], nullableStrings = [], numbers = [], booleans = [] }
) => {
  const output = {};

  for (const key of strings) copyString(source, output, key);
  for (const key of nullableStrings) {
    copyString(source, output, key, { nullable: true });
  }
  for (const key of numbers) copyNumber(source, output, key);
  for (const key of booleans) copyBoolean(source, output, key);

  return output;
};

const sanitizeStringArray = (value) => {
  if (!Array.isArray(value)) return null;

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
};

const sanitizeNumberMap = (value, fields) => {
  if (!isRecord(value)) return null;

  const output = {};
  for (const key of fields) copyNumber(value, output, key);

  return Object.keys(output).length > 0 ? output : null;
};

const sanitizeMarketOutlook = (value) => {
  if (!isRecord(value)) return null;

  const output = copyFields(value, {
    strings: [
      "status",
      "strength",
      "signal_alignment",
      "price_signal",
      "direction_signal",
      "summary",
    ],
    numbers: ["confidence"],
  });

  return Object.keys(output).length > 0 ? output : null;
};

const sanitizeDirectionModelSignal = (value) => {
  if (!isRecord(value)) return null;

  const output = copyFields(value, {
    strings: ["prediction", "confidence_label", "note"],
    numbers: [
      "up_probability",
      "down_probability",
      "confidence_probability",
    ],
  });

  return Object.keys(output).length > 0 ? output : null;
};

const sanitizeOutcomeSignal = (value) => {
  if (!isRecord(value)) return null;

  const output = copyFields(value, {
    strings: ["direction", "basis", "message"],
    numbers: ["change_rs_per_kg", "change_pct"],
  });

  return Object.keys(output).length > 0 ? output : null;
};

const sanitizeMarketContextSignal = (value) => {
  if (!isRecord(value)) return null;

  const output = copyFields(value, {
    strings: ["trend", "basis", "message"],
    numbers: ["change_rs_per_kg", "change_pct"],
  });

  return Object.keys(output).length > 0 ? output : null;
};

const sanitizeMarket = (value) => {
  if (!isRecord(value)) return null;

  const output = copyFields(value, {
    strings: MARKET_STRING_FIELDS,
    numbers: MARKET_NUMBER_FIELDS,
    booleans: MARKET_BOOLEAN_FIELDS,
  });

  const probabilities = sanitizeNumberMap(value.probabilities, ["UP", "DOWN"]);
  if (probabilities) output.probabilities = probabilities;

  const priceModelMetrics = sanitizeNumberMap(value.price_model_metrics, [
    "mae",
    "rmse",
    "r2",
    "mape",
  ]);
  if (priceModelMetrics) output.price_model_metrics = priceModelMetrics;

  const marketOutlook = sanitizeMarketOutlook(value.market_outlook);
  if (marketOutlook) output.market_outlook = marketOutlook;

  const directionModelSignal = sanitizeDirectionModelSignal(
    value.direction_model_signal
  );
  if (directionModelSignal) {
    output.direction_model_signal = directionModelSignal;
  }

  const farmerOutcomeSignal = sanitizeOutcomeSignal(value.farmer_outcome_signal);
  if (farmerOutcomeSignal) output.farmer_outcome_signal = farmerOutcomeSignal;

  const marketContextSignal = sanitizeMarketContextSignal(
    value.market_context_signal
  );
  if (marketContextSignal) output.market_context_signal = marketContextSignal;

  const actionReasonCodes = sanitizeStringArray(value.action_reason_codes);
  if (actionReasonCodes) output.action_reason_codes = actionReasonCodes;

  return Object.keys(output).length > 0 ? output : null;
};

const sanitizeAiInsights = (value) => {
  if (!isRecord(value)) return null;

  const output = copyFields(value, { strings: AI_INSIGHT_FIELDS });
  return Object.keys(output).length > 0 ? output : null;
};

const sanitizeWeatherDay = (value) => {
  if (!isRecord(value)) return null;

  const output = copyFields(value, {
    strings: ["date"],
    numbers: [
      "weather_code",
      "temperature_max_c",
      "temperature_min_c",
      "rain_probability",
      "rainfall_mm",
    ],
  });

  return Object.keys(output).length > 0 ? output : null;
};

const sanitizeWeatherForecast = (value) => {
  if (!isRecord(value)) return null;

  const output = copyFields(value, {
    strings: ["location", "period", "source"],
  });

  if (Array.isArray(value.days)) {
    output.days = value.days
      .slice(0, 7)
      .map(sanitizeWeatherDay)
      .filter(Boolean);
  }

  return Object.keys(output).length > 0 ? output : null;
};

const buildRecommendationSnapshot = (payload) => {
  if (!isRecord(payload)) return {};

  const snapshot = copyFields(payload, {
    strings: [
      "crop",
      "farmer_district",
      "current_price_source",
      "action_decision",
    ],
    nullableStrings: ["model_version", "policy_version"],
    numbers: [
      "current_price",
      "experimental_price",
      "persistence_baseline",
      "quantity_kg",
      "horizon",
    ],
    booleans: ["action_authorized"],
  });

  const availableMarkets = sanitizeStringArray(payload.available_markets);
  if (availableMarkets) snapshot.available_markets = availableMarkets;

  if (Array.isArray(payload.comparisons)) {
    snapshot.comparisons = payload.comparisons
      .map(sanitizeMarket)
      .filter(Boolean);
  }

  const recommendedMarket = sanitizeMarket(payload.recommended_market);
  if (recommendedMarket) snapshot.recommended_market = recommendedMarket;

  if (payload.market_outlook === null) {
    snapshot.market_outlook = null;
  } else {
    const marketOutlook = sanitizeMarketOutlook(payload.market_outlook);
    if (marketOutlook) snapshot.market_outlook = marketOutlook;
  }

  if (payload.ai_insights === null) {
    snapshot.ai_insights = null;
  } else {
    const aiInsights = sanitizeAiInsights(payload.ai_insights);
    if (aiInsights) snapshot.ai_insights = aiInsights;
  }

  if (payload.weather_forecast === null) {
    snapshot.weather_forecast = null;
  } else {
    const weatherForecast = sanitizeWeatherForecast(payload.weather_forecast);
    if (weatherForecast) snapshot.weather_forecast = weatherForecast;
  }

  return snapshot;
};

module.exports = {
  buildRecommendationSnapshot,
};
