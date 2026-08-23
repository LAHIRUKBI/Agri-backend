const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPrompt,
  createFallbackInsights,
  sanitizeInsights,
} = require("../../src/utils/groqInsightGenerator");

const baseRecommendationData = (weatherContext = null) => ({
  input: { crop: "beans", district: "meegoda", horizon: 1 },
  nearestMarket: {
    market: "meegoda",
    prediction: "DOWN",
    up_probability: 0.44,
    down_probability: 0.56,
    action_decision: "UNCERTAIN",
    current_price_rs_kg: 400,
    predicted_price_rs_kg: 425.6,
  },
  bestPredictedMarket: {
    market: "kandy",
    prediction: "UP",
    up_probability: 0.55,
    down_probability: 0.45,
    current_price_rs_kg: 400,
    predicted_price_rs_kg: 418.27,
  },
  recommendedMarket: { market: "meegoda", action_decision: "UNCERTAIN" },
  actionDecision: "UNCERTAIN",
  weatherContext,
  comparisons: [],
  comparisonStrength: "weak",
  comparisonNote: null,
  isCloseCall: true,
  probabilityDelta: 0.01,
});

const highWeather = {
  period: "next_7_days",
  forecast_location: "meegoda",
  total_rainfall_mm: 75,
  average_daily_rainfall_mm: 10.71,
  rainy_days: 6,
  max_rain_probability: 90,
  rainfall_risk: "HIGH",
  source: "open_meteo",
};

test("HIGH weather appears only as operational fallback advice", () => {
  const fallback = createFallbackInsights(baseRecommendationData(highWeather));
  const text = `${fallback.why_this_matters} ${fallback.suggested_action}`;

  assert.match(text, /rainfall/i);
  assert.match(text, /harvesting|transport|storage/i);
  assert.doesNotMatch(text, /\b(?:sell now|sell immediately|sell before|wait|hold)\b/i);
});

test("null weather produces no weather advice", () => {
  const fallback = createFallbackInsights(baseRecommendationData(null));
  const text = Object.values(fallback).join(" ");

  assert.doesNotMatch(text, /\b(?:rain|rainfall|weather|forecast)\b/i);
});

test("prompt includes structured weather and strict weather boundaries", () => {
  const prompt = buildPrompt(baseRecommendationData(highWeather));

  assert.match(prompt, /"weather_context"/);
  assert.match(prompt, /"forecast_location": "meegoda"/);
  assert.match(prompt, /Do not recalculate rainfall_risk/);
  assert.match(prompt, /Weather must never override canonical_action_decision/);
});

test("invented numerical weather values are rejected", () => {
  const data = baseRecommendationData(highWeather);
  const fallback = createFallbackInsights(data);
  const generated = { ...fallback, why_this_matters: "Rainfall may reach 999 millimetres." };
  const sanitized = sanitizeInsights(generated, fallback, data);

  assert.equal(sanitized.why_this_matters, fallback.why_this_matters);
  assert.doesNotMatch(sanitized.why_this_matters, /999/);
});

test("UNCERTAIN rejects unsafe selling and waiting instructions per field", () => {
  const data = baseRecommendationData(highWeather);
  const fallback = createFallbackInsights(data);
  const unsafePhrases = [
    "Sell now to avoid disruption.",
    "Sell your crop now to avoid disruption.",
    "Sell immediately when transport is available.",
    "Sell before rain reaches the farm.",
    "Wait for a better price.",
    "Hold the crop for later.",
    "Delay selling until conditions improve.",
    "Postpone the sale until conditions improve.",
  ];

  for (const phrase of unsafePhrases) {
    const generated = { ...fallback, suggested_action: phrase };
    const sanitized = sanitizeInsights(generated, fallback, data);
    assert.equal(sanitized.suggested_action, fallback.suggested_action);
  }
});

test("neutral experimental-price description is retained", () => {
  const data = baseRecommendationData(null);
  const fallback = createFallbackInsights(data);
  const neutral = "The experimental estimate is lower, but it is not action-authorized.";
  const sanitized = sanitizeInsights(
    { ...fallback, price_movement: neutral },
    fallback,
    data
  );

  assert.equal(sanitized.price_movement, neutral);
});

test("fallback remains consistent with UNCERTAIN", () => {
  const fallback = createFallbackInsights(baseRecommendationData(highWeather));
  const text = Object.values(fallback).join(" ");

  assert.match(text, /uncertain/i);
  assert.doesNotMatch(
    text,
    /\b(?:sell now|sell immediately|sell before|wait|hold|delay selling)\b/i
  );
});
