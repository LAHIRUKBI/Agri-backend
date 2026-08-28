const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRecommendationSnapshot,
} = require("../../src/utils/recommendationSnapshot");

const buildPayload = () => ({
  crop: " Beans ",
  farmer_district: " Colombo ",
  available_markets: [" Meegoda ", "Kandy"],
  comparisons: [
    {
      market: " Meegoda ",
      farmer_district: "Colombo",
      prediction: "DOWN",
      probabilities: { UP: 0.44, DOWN: 0.56, secret: 1 },
      current_price_rs_kg: 400,
      predicted_price_rs_kg: 425.6,
      price_model_metrics: { mae: 63.84, rmse: 81, internal: "drop" },
      market_outlook: {
        status: "MIXED",
        strength: "MODERATE",
        summary: " Mixed evidence. ",
        secret: "drop",
      },
      action_decision: "UNCERTAIN",
      action_authorized: false,
      action_reason_codes: [" MODEL_SIGNAL_CONFLICT ", ""],
      meta: { internal_rows: 42, JWT_SECRET: "drop" },
      headers: { authorization: "Bearer secret" },
    },
  ],
  recommended_market: {
    market: " Meegoda ",
    current_price_source: "manual",
    resolved_current_price_rs_kg: 400,
    predicted_price_rs_kg: 425.6,
    persistence_next_price_rs_kg: 400,
    model_run_id: "run_001",
    action_policy: "persistence_primary_v1",
    action_authorized: false,
    direction_model_signal: {
      prediction: "DOWN",
      confidence_probability: 0.56,
      note: " Experimental evidence only. ",
      raw_provider_response: "drop",
    },
    meta: { feature_row: "drop" },
  },
  current_price: 400,
  current_price_source: " manual ",
  experimental_price: 425.6,
  persistence_baseline: 400,
  market_outlook: {
    status: "MIXED",
    strength: "MODERATE",
    signal_alignment: "CONFLICT",
    price_signal: "UP",
    direction_signal: "DOWN",
    confidence: 0.56,
    summary: " Signals disagree. ",
    raw_model: { secret: true },
  },
  action_decision: " UNCERTAIN ",
  action_authorized: false,
  quantity_kg: 100,
  ai_insights: {
    recommendation: " Compare current offers. ",
    prediction_summary: " Evidence is mixed. ",
    price_movement: " Experimental movement only. ",
    prediction_strength: " Moderate confidence. ",
    why_this_matters: " Conditions may change. ",
    suggested_action: " Check transport and storage. ",
    raw_prompt: "drop",
    apiKey: "drop",
  },
  weather_forecast: {
    location: " Colombo ",
    period: "next_7_days",
    source: "open_meteo",
    days: [
      {
        date: "2026-08-26",
        weather_code: 61,
        temperature_max_c: 30,
        temperature_min_c: 24,
        rain_probability: 70,
        rainfall_mm: 8.5,
        request_headers: { secret: true },
      },
    ],
    api_key: "drop",
  },
  model_version: " run_001 ",
  policy_version: " persistence_primary_v1 ",
  horizon: 1,
  user_id: "attacker-selected-user",
  user: { password: "drop" },
  token: "drop",
  authorization: "drop",
  headers: { authorization: "drop" },
  cookies: "drop",
  password: "drop",
  JWT_SECRET: "drop",
  GROQ_API_KEY: "drop",
  recommendation_fingerprint: "frontend-fingerprint",
  prediction_target_date: "2099-01-01T00:00:00.000Z",
  status: "ARCHIVED",
  scheduled_for: "2099-01-01T00:00:00.000Z",
  unknown_field: "drop",
});

test("snapshot includes only the explicit top-level allowlist", () => {
  const snapshot = buildRecommendationSnapshot(buildPayload());

  assert.deepEqual(Object.keys(snapshot).sort(), [
    "action_authorized",
    "action_decision",
    "ai_insights",
    "available_markets",
    "comparisons",
    "crop",
    "current_price",
    "current_price_source",
    "experimental_price",
    "farmer_district",
    "horizon",
    "market_outlook",
    "model_version",
    "persistence_baseline",
    "policy_version",
    "quantity_kg",
    "recommended_market",
    "weather_forecast",
  ]);

  assert.equal(snapshot.crop, "Beans");
  assert.equal(snapshot.farmer_district, "Colombo");
  assert.equal(snapshot.action_authorized, false);
  assert.deepEqual(snapshot.available_markets, ["Meegoda", "Kandy"]);
});

test("snapshot strips sensitive and unknown fields at every supported level", () => {
  const snapshot = buildRecommendationSnapshot(buildPayload());
  const serialized = JSON.stringify(snapshot);

  for (const forbiddenValue of [
    "attacker-selected-user",
    "frontend-fingerprint",
    "Bearer secret",
    "raw_prompt",
    "apiKey",
    "JWT_SECRET",
    "GROQ_API_KEY",
    "internal_rows",
    "feature_row",
    "request_headers",
    "unknown_field",
  ]) {
    assert.equal(serialized.includes(forbiddenValue), false);
  }

  assert.equal("meta" in snapshot.comparisons[0], false);
  assert.equal("headers" in snapshot.comparisons[0], false);
  assert.deepEqual(snapshot.comparisons[0].probabilities, {
    UP: 0.44,
    DOWN: 0.56,
  });
  assert.deepEqual(snapshot.comparisons[0].price_model_metrics, {
    mae: 63.84,
    rmse: 81,
  });
});

test("snapshot applies deliberate outlook, AI, weather, and market allowlists", () => {
  const snapshot = buildRecommendationSnapshot(buildPayload());

  assert.deepEqual(snapshot.market_outlook, {
    status: "MIXED",
    strength: "MODERATE",
    signal_alignment: "CONFLICT",
    price_signal: "UP",
    direction_signal: "DOWN",
    summary: "Signals disagree.",
    confidence: 0.56,
  });
  assert.deepEqual(Object.keys(snapshot.ai_insights), [
    "recommendation",
    "prediction_summary",
    "price_movement",
    "prediction_strength",
    "why_this_matters",
    "suggested_action",
  ]);
  assert.deepEqual(snapshot.weather_forecast.days[0], {
    date: "2026-08-26",
    weather_code: 61,
    temperature_max_c: 30,
    temperature_min_c: 24,
    rain_probability: 70,
    rainfall_mm: 8.5,
  });
  assert.equal(snapshot.recommended_market.market, "Meegoda");
  assert.equal("meta" in snapshot.recommended_market, false);
});

test("snapshot is a deep independent copy and does not mutate input", () => {
  const payload = buildPayload();
  const original = structuredClone(payload);
  const snapshot = buildRecommendationSnapshot(payload);

  assert.deepEqual(payload, original);
  assert.notEqual(snapshot.comparisons, payload.comparisons);
  assert.notEqual(snapshot.comparisons[0], payload.comparisons[0]);
  assert.notEqual(snapshot.market_outlook, payload.market_outlook);
  assert.notEqual(snapshot.ai_insights, payload.ai_insights);
  assert.notEqual(snapshot.weather_forecast, payload.weather_forecast);
  assert.notEqual(snapshot.weather_forecast.days, payload.weather_forecast.days);

  payload.comparisons[0].market = "Changed";
  payload.market_outlook.summary = "Changed";
  payload.weather_forecast.days[0].rainfall_mm = 999;

  assert.equal(snapshot.comparisons[0].market, "Meegoda");
  assert.equal(snapshot.market_outlook.summary, "Signals disagree.");
  assert.equal(snapshot.weather_forecast.days[0].rainfall_mm, 8.5);
});

test("malformed optional structures are safely omitted or reduced", () => {
  const snapshot = buildRecommendationSnapshot({
    crop: "beans",
    comparisons: [null, "bad", { market: " Kandy ", secret: "drop" }],
    recommended_market: "bad",
    market_outlook: "bad",
    ai_insights: { raw_prompt: "drop" },
    weather_forecast: { days: [null, { date: " 2026-08-26 ", raw: 1 }] },
  });

  assert.deepEqual(snapshot, {
    crop: "beans",
    comparisons: [{ market: "Kandy" }],
    weather_forecast: { days: [{ date: "2026-08-26" }] },
  });
});

test("null remains explicit for meaningful optional fields", () => {
  const snapshot = buildRecommendationSnapshot({
    experimental_price: null,
    persistence_baseline: null,
    model_version: null,
    policy_version: null,
    market_outlook: null,
    ai_insights: null,
    weather_forecast: null,
  });

  assert.deepEqual(snapshot, {
    model_version: null,
    policy_version: null,
    experimental_price: null,
    persistence_baseline: null,
    market_outlook: null,
    ai_insights: null,
    weather_forecast: null,
  });
});
