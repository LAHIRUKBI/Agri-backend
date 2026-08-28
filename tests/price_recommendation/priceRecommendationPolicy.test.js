const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ACTION_POLICY,
  MIN_ACTIONABLE_PRICE_DIFFERENCE_RS,
  PRICE_DIFFERENCE_EPSILON_RS,
  buildPriceRecommendationDecision,
} = require("../../src/services/priceRecommendationPolicy");

const decide = (currentPrice, predictedPrice, extraEvidence = {}) =>
  buildPriceRecommendationDecision({
    currentPrice,
    predictedPrice,
    ...extraEvidence,
  });

const assertDecision = (
  result,
  actionDecision,
  actionAuthorized,
  reasonCode
) => {
  assert.equal(result.action_decision, actionDecision);
  assert.equal(result.action_authorized, actionAuthorized);
  assert.equal(result.action_policy, "rs5_price_direction_v1");
  assert.deepEqual(result.action_reason_codes, [reasonCode]);
};

test("policy publishes the Rs.5 price-direction version and boundary", () => {
  assert.equal(ACTION_POLICY, "rs5_price_direction_v1");
  assert.equal(MIN_ACTIONABLE_PRICE_DIFFERENCE_RS, 5);
  assert.equal(PRICE_DIFFERENCE_EPSILON_RS, 1e-9);
});

const boundaryCases = [
  {
    name: "+4.99 remains uncertain",
    predictedPrice: 304.99,
    decision: "UNCERTAIN",
    authorized: false,
    reason: "PRICE_DIFFERENCE_BELOW_RS5_THRESHOLD",
  },
  {
    name: "+5.00 authorizes waiting",
    predictedPrice: 305,
    decision: "WAIT",
    authorized: true,
    reason: "PREDICTED_PRICE_INCREASE_AT_LEAST_RS5",
  },
  {
    name: "-4.99 remains uncertain",
    predictedPrice: 295.01,
    decision: "UNCERTAIN",
    authorized: false,
    reason: "PRICE_DIFFERENCE_BELOW_RS5_THRESHOLD",
  },
  {
    name: "-5.00 authorizes selling now",
    predictedPrice: 295,
    decision: "SELL_NOW",
    authorized: true,
    reason: "PREDICTED_PRICE_DECREASE_AT_LEAST_RS5",
  },
];

for (const boundaryCase of boundaryCases) {
  test(boundaryCase.name, () => {
    assertDecision(
      decide(300, boundaryCase.predictedPrice),
      boundaryCase.decision,
      boundaryCase.authorized,
      boundaryCase.reason
    );
  });
}

test("small positive, negative, and equal prices remain uncertain", () => {
  for (const predictedPrice of [301, 303, 297, 299, 300]) {
    assertDecision(
      decide(300, predictedPrice),
      "UNCERTAIN",
      false,
      "PRICE_DIFFERENCE_BELOW_RS5_THRESHOLD"
    );
  }
});

test("wholesale Rs.5 and Rs.10 movements are actionable at different price scales", () => {
  const cases = [
    [300, 305, "WAIT", "PREDICTED_PRICE_INCREASE_AT_LEAST_RS5"],
    [300, 310, "WAIT", "PREDICTED_PRICE_INCREASE_AT_LEAST_RS5"],
    [300, 295, "SELL_NOW", "PREDICTED_PRICE_DECREASE_AT_LEAST_RS5"],
    [300, 290, "SELL_NOW", "PREDICTED_PRICE_DECREASE_AT_LEAST_RS5"],
    [800, 805, "WAIT", "PREDICTED_PRICE_INCREASE_AT_LEAST_RS5"],
    [800, 795, "SELL_NOW", "PREDICTED_PRICE_DECREASE_AT_LEAST_RS5"],
  ];

  for (const [currentPrice, predictedPrice, decision, reason] of cases) {
    assertDecision(decide(currentPrice, predictedPrice), decision, true, reason);
  }
});

test("classifier direction cannot veto the price action", () => {
  const cases = [
    [310, "UP", "WAIT"],
    [310, "DOWN", "WAIT"],
    [290, "UP", "SELL_NOW"],
    [290, "DOWN", "SELL_NOW"],
  ];

  for (const [predictedPrice, classifierPrediction, expected] of cases) {
    const result = decide(300, predictedPrice, { classifierPrediction });
    assert.equal(result.action_decision, expected);
    assert.equal(result.action_authorized, true);
    assert.ok(!result.action_reason_codes.includes("MODEL_SIGNAL_CONFLICT"));
  }
});

test("classifier probabilities cannot change an actionable price decision", () => {
  for (const probability of [0.1, 0.5, 0.95]) {
    const evidence = {
      classifierPrediction: "DOWN",
      upProbability: probability,
      downProbability: 1 - probability,
      contextQuality: "incomplete",
    };

    assert.equal(decide(300, 310, evidence).action_decision, "WAIT");
    assert.equal(decide(300, 290, evidence).action_decision, "SELL_NOW");
  }
});

test("missing, nonnumeric, nonfinite, and nonpositive current prices are uncertain", () => {
  const invalidCurrentPrices = [
    undefined,
    null,
    "",
    "not-a-number",
    false,
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ];

  for (const currentPrice of invalidCurrentPrices) {
    const result = decide(currentPrice, 310);
    assert.equal(result.action_decision, "UNCERTAIN");
    assert.equal(result.action_authorized, false);
    assert.ok(result.action_reason_codes.includes("CURRENT_PRICE_UNAVAILABLE"));
    assert.equal(result.persistence_next_price_rs_kg, null);
  }
});

test("missing, nonnumeric, and nonfinite predictions are uncertain", () => {
  const invalidPredictedPrices = [
    undefined,
    null,
    "",
    "not-a-number",
    false,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];

  for (const predictedPrice of invalidPredictedPrices) {
    const result = decide(300, predictedPrice);
    assert.equal(result.action_decision, "UNCERTAIN");
    assert.equal(result.action_authorized, false);
    assert.ok(result.action_reason_codes.includes("MODEL_ESTIMATE_UNAVAILABLE"));
    assert.equal(result.persistence_next_price_rs_kg, 300);
  }
});

test("both missing prices report both unavailable reasons", () => {
  const result = decide(undefined, undefined);
  assert.deepEqual(result.action_reason_codes, [
    "CURRENT_PRICE_UNAVAILABLE",
    "MODEL_ESTIMATE_UNAVAILABLE",
  ]);
});

test("floating-point noise at conceptual Rs.5 boundaries remains actionable", () => {
  assert.equal(decide(300, 304.99999999999994).action_decision, "WAIT");
  assert.equal(decide(300, 295.00000000000006).action_decision, "SELL_NOW");
  assert.equal(decide(300, 304.999999).action_decision, "UNCERTAIN");
  assert.equal(decide(300, 295.000001).action_decision, "UNCERTAIN");
});

test("decimal predictions are compared without rounding", () => {
  assertDecision(
    decide(424, 415.95),
    "SELL_NOW",
    true,
    "PREDICTED_PRICE_DECREASE_AT_LEAST_RS5"
  );
  assertDecision(
    decide(382, 389.34),
    "WAIT",
    true,
    "PREDICTED_PRICE_INCREASE_AT_LEAST_RS5"
  );
});

test("valid decisions no longer emit persistence or model-authorization blocks", () => {
  for (const predictedPrice of [290, 300, 310]) {
    const reasonCodes = decide(300, predictedPrice).action_reason_codes;
    assert.ok(!reasonCodes.includes("PERSISTENCE_NO_DIRECTIONAL_EDGE"));
    assert.ok(!reasonCodes.includes("MODEL_NOT_ACTION_AUTHORIZED"));
  }
});
