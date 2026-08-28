const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const SavedRecommendation = require("../../src/models/SavedRecommendation");

const validRecommendation = (overrides = {}) => ({
  user: new mongoose.Types.ObjectId(),
  crop: "Beans",
  farmer_district: "Colombo",
  recommended_market: "Meegoda",
  current_price: 400,
  current_price_source: "manual",
  experimental_price: 425.6,
  persistence_baseline: 400,
  quantity_kg: 100,
  horizon: 1,
  market_outlook_status: "MIXED",
  market_outlook_strength: "MODERATE",
  action_decision: "UNCERTAIN",
  action_authorized: false,
  model_version: "run_001",
  policy_version: "persistence_primary_v1",
  prediction_target_date: new Date("2026-09-02T04:30:00.000Z"),
  recommendation_fingerprint: "fingerprint-001",
  recommendation_snapshot: { crop: "beans", comparisons: [] },
  ...overrides,
});

const validationErrorFor = (overrides) =>
  new SavedRecommendation(validRecommendation(overrides)).validateSync();

const hasIndex = (schema, expectedFields, expectedOptions = {}) =>
  schema.indexes().some(([fields, options]) => {
    const fieldEntries = Object.entries(fields);
    const expectedFieldEntries = Object.entries(expectedFields);

    return (
      fieldEntries.length === expectedFieldEntries.length &&
      expectedFieldEntries.every(([key, value]) => fields[key] === value) &&
      Object.entries(expectedOptions).every(
        ([key, value]) => options[key] === value
      )
    );
  });

test("SavedRecommendation uses ObjectId ownership referencing User", () => {
  const userPath = SavedRecommendation.schema.path("user");
  assert.equal(userPath.instance, "ObjectId");
  assert.equal(userPath.options.ref, "User");
  assert.equal(userPath.options.required, true);
});

test("SavedRecommendation requires ownership", () => {
  const error = validationErrorFor({ user: undefined });
  assert.ok(error.errors.user);
});

test("SavedRecommendation accepts valid lifecycle states and rejects invalid ones", () => {
  for (const status of ["ACTIVE", "DUE_SOON", "DUE", "ARCHIVED"]) {
    assert.equal(validationErrorFor({ status }), undefined);
  }

  const error = validationErrorFor({ status: "SELL_NOW" });
  assert.ok(error.errors.status);
});

test("SavedRecommendation defaults lifecycle status to ACTIVE", () => {
  const recommendation = new SavedRecommendation(validRecommendation());
  assert.equal(recommendation.status, "ACTIVE");
});

test("SavedRecommendation supports only horizon one", () => {
  assert.equal(validationErrorFor({ horizon: 1 }), undefined);
  assert.ok(validationErrorFor({ horizon: 2 }).errors.horizon);
});

test("SavedRecommendation requires finite positive quantity and current price", () => {
  assert.ok(
    validationErrorFor({ quantity_kg: undefined }).errors.quantity_kg
  );
  assert.ok(validationErrorFor({ quantity_kg: 0 }).errors.quantity_kg);
  assert.ok(validationErrorFor({ quantity_kg: Infinity }).errors.quantity_kg);
  assert.ok(
    validationErrorFor({ current_price: undefined }).errors.current_price
  );
  assert.ok(validationErrorFor({ current_price: 0 }).errors.current_price);
  assert.ok(validationErrorFor({ current_price: Infinity }).errors.current_price);
});

test("SavedRecommendation validates optional evidence prices", () => {
  assert.equal(
    validationErrorFor({ experimental_price: null, persistence_baseline: null }),
    undefined
  );
  assert.ok(
    validationErrorFor({ experimental_price: -1 }).errors.experimental_price
  );
  assert.ok(
    validationErrorFor({ persistence_baseline: Infinity }).errors
      .persistence_baseline
  );
});

test("SavedRecommendation validates market outlook values", () => {
  for (const status of ["UPWARD", "DOWNWARD", "MIXED", "STABLE", "LIMITED"]) {
    assert.equal(validationErrorFor({ market_outlook_status: status }), undefined);
  }

  const error = validationErrorFor({ market_outlook_status: "UNKNOWN" });
  assert.ok(error.errors.market_outlook_status);
});

test("SavedRecommendation accepts all canonical Rs.5 policy outcomes", () => {
  const outcomes = [
    ["WAIT", true],
    ["SELL_NOW", true],
    ["UNCERTAIN", false],
  ];

  for (const [actionDecision, actionAuthorized] of outcomes) {
    assert.equal(
      validationErrorFor({
        action_decision: actionDecision,
        action_authorized: actionAuthorized,
        policy_version: "rs5_price_direction_v1",
      }),
      undefined
    );
  }
});

test("SavedRecommendation requires snapshot and fingerprint", () => {
  assert.ok(
    validationErrorFor({ recommendation_snapshot: undefined }).errors
      .recommendation_snapshot
  );
  assert.ok(
    validationErrorFor({ recommendation_fingerprint: undefined }).errors
      .recommendation_fingerprint
  );
});

test("SavedRecommendation enables timestamps and expected indexes", () => {
  const schema = SavedRecommendation.schema;
  assert.equal(schema.options.timestamps, true);
  assert.ok(hasIndex(schema, { user: 1 }));
  assert.ok(hasIndex(schema, { prediction_target_date: 1 }));
  assert.ok(hasIndex(schema, { status: 1 }));
  assert.ok(
    hasIndex(
      schema,
      { user: 1, recommendation_fingerprint: 1 },
      { unique: true }
    )
  );
  assert.ok(hasIndex(schema, { user: 1, createdAt: -1 }));
});
