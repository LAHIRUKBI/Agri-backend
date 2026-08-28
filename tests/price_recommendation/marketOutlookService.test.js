const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildMarketOutlook,
  getConfidenceStrength,
} = require("../../src/services/marketOutlookService");
const {
  buildPriceRecommendationDecision,
} = require("../../src/services/priceRecommendationPolicy");

const outlookFor = (priceSignal, directionSignal, confidence = 0.7) =>
  buildMarketOutlook({ priceSignal, directionSignal, confidence });

test("UP price plus UP classifier produces an UPWARD outlook", () => {
  assert.deepEqual(outlookFor("UP", "UP", 0.55), {
    status: "UPWARD",
    strength: "LOW",
    signal_alignment: "ALIGNED",
    price_signal: "UP",
    direction_signal: "UP",
    confidence: 0.55,
    summary: "Both experimental signals point upward, but confidence is low.",
  });
});

test("DOWN price plus DOWN classifier produces a DOWNWARD outlook", () => {
  assert.deepEqual(outlookFor("DOWN", "DOWN", 0.68), {
    status: "DOWNWARD",
    strength: "MODERATE",
    signal_alignment: "ALIGNED",
    price_signal: "DOWN",
    direction_signal: "DOWN",
    confidence: 0.68,
    summary:
      "Both experimental signals point downward with moderate confidence.",
  });
});

test("UP price plus DOWN classifier produces a MIXED outlook", () => {
  const outlook = outlookFor("UP", "DOWN");
  assert.equal(outlook.status, "MIXED");
  assert.equal(outlook.signal_alignment, "CONFLICT");
});

test("DOWN price plus UP classifier produces a MIXED outlook", () => {
  const outlook = outlookFor("DOWN", "UP");
  assert.equal(outlook.status, "MIXED");
  assert.equal(outlook.signal_alignment, "CONFLICT");
});

test("a STABLE price signal produces a STABLE outlook", () => {
  const outlook = outlookFor("STABLE", "UP");
  assert.equal(outlook.status, "STABLE");
  assert.equal(outlook.signal_alignment, "STABLE");
  assert.equal(
    outlook.summary,
    "The experimental price estimate is close to the current price, so there is no clear price edge."
  );
});

test("a missing required signal produces a LIMITED outlook", () => {
  assert.deepEqual(outlookFor(null, "UP", 0.72), {
    status: "LIMITED",
    strength: "MODERATE",
    signal_alignment: "UNKNOWN",
    price_signal: null,
    direction_signal: "UP",
    confidence: 0.72,
    summary: "Not enough model evidence is available for a clear market outlook.",
  });
  assert.equal(outlookFor("UP", null).status, "LIMITED");
});

test("numeric confidence is preserved exactly", () => {
  assert.equal(outlookFor("UP", "UP", 0.5726).confidence, 0.5726);
});

test("existing confidence boundaries produce LOW, MODERATE, and STRONG", () => {
  assert.equal(getConfidenceStrength(0.5999), "LOW");
  assert.equal(getConfidenceStrength(0.6), "MODERATE");
  assert.equal(getConfidenceStrength(0.7499), "MODERATE");
  assert.equal(getConfidenceStrength(0.75), "STRONG");
});

test("market outlook never changes or invents a canonical action", () => {
  const upwardOutlook = outlookFor("UP", "UP", 0.9);
  const downwardOutlook = outlookFor("DOWN", "DOWN", 0.9);
  const decision = buildPriceRecommendationDecision({
    currentPrice: 400,
    predictedPrice: 500,
    classifierPrediction: "UP",
    upProbability: 0.9,
    downProbability: 0.1,
    contextQuality: "complete",
  });

  assert.equal(decision.action_decision, "WAIT");
  assert.equal(decision.action_authorized, true);
  assert.equal(upwardOutlook.status, "UPWARD");
  assert.equal(downwardOutlook.status, "DOWNWARD");
  assert.doesNotMatch(JSON.stringify(upwardOutlook), /\bWAIT\b/i);
  assert.doesNotMatch(JSON.stringify(downwardOutlook), /\bSELL_NOW\b|\bSELL NOW\b/i);
});
