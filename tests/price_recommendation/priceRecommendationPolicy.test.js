const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildPriceRecommendationDecision,
} = require("../../src/services/priceRecommendationPolicy");

test("conflicting classifier and regressor signals remain uncertain", () => {
  const result = buildPriceRecommendationDecision({
    currentPrice: 400,
    predictedPrice: 425.6,
    classifierPrediction: "DOWN",
    upProbability: 0.4355,
    downProbability: 0.5645,
    contextQuality: "incomplete",
  });

  assert.equal(result.action_decision, "UNCERTAIN");
  assert.equal(result.action_authorized, false);
  assert.equal(result.persistence_next_price_rs_kg, 400);
  assert.ok(result.action_reason_codes.includes("MODEL_SIGNAL_CONFLICT"));
  assert.ok(result.action_reason_codes.includes("MODEL_CONTEXT_INCOMPLETE"));
  assert.ok(result.action_reason_codes.includes("MODEL_NOT_ACTION_AUTHORIZED"));
});

test("a small learned-model difference remains uncertain", () => {
  const result = buildPriceRecommendationDecision({
    currentPrice: 400,
    predictedPrice: 404,
    classifierPrediction: "UP",
    upProbability: 0.7,
    downProbability: 0.3,
    contextQuality: "complete",
  });

  assert.equal(result.action_decision, "UNCERTAIN");
  assert.ok(result.action_reason_codes.includes("MODEL_DIFFERENCE_SMALL"));
});

test("missing confidence cannot authorize a selling action", () => {
  const result = buildPriceRecommendationDecision({
    currentPrice: 400,
    predictedPrice: 500,
    classifierPrediction: "UP",
    contextQuality: "complete",
  });

  assert.equal(result.action_decision, "UNCERTAIN");
  assert.equal(result.action_authorized, false);
  assert.ok(
    result.action_reason_codes.includes("MODEL_CONFIDENCE_INSUFFICIENT")
  );
});

test("even agreeing model signals are experimental under persistence policy", () => {
  const result = buildPriceRecommendationDecision({
    currentPrice: 400,
    predictedPrice: 500,
    classifierPrediction: "UP",
    upProbability: 0.9,
    downProbability: 0.1,
    contextQuality: "complete",
  });

  assert.equal(result.action_decision, "UNCERTAIN");
  assert.equal(result.model_estimate_experimental, true);
  assert.ok(result.action_reason_codes.includes("PERSISTENCE_NO_DIRECTIONAL_EDGE"));
});
