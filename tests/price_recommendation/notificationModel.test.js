const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const Notification = require("../../src/models/Notification");

const validNotification = (overrides = {}) => ({
  user: new mongoose.Types.ObjectId(),
  recommendation: new mongoose.Types.ObjectId(),
  type: "RECOMMENDATION_DUE_SOON",
  title: "Recommendation due soon",
  message: "Review your saved recommendation before its target date.",
  scheduled_for: new Date("2026-09-01T04:30:00.000Z"),
  ...overrides,
});

const validationErrorFor = (overrides) =>
  new Notification(validNotification(overrides)).validateSync();

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

test("Notification uses ObjectId ownership and recommendation references", () => {
  const userPath = Notification.schema.path("user");
  const recommendationPath = Notification.schema.path("recommendation");

  assert.equal(userPath.instance, "ObjectId");
  assert.equal(userPath.options.ref, "User");
  assert.equal(recommendationPath.instance, "ObjectId");
  assert.equal(recommendationPath.options.ref, "SavedRecommendation");
});

test("Notification requires both ownership references", () => {
  assert.ok(validationErrorFor({ user: undefined }).errors.user);
  assert.ok(
    validationErrorFor({ recommendation: undefined }).errors.recommendation
  );
});

test("Notification accepts only recommendation reminder types", () => {
  for (const type of [
    "RECOMMENDATION_DUE_SOON",
    "RECOMMENDATION_DUE",
    "RECOMMENDATION_CUSTOM",
  ]) {
    assert.equal(validationErrorFor({ type }), undefined);
  }

  const error = validationErrorFor({ type: "MARKETING_MESSAGE" });
  assert.ok(error.errors.type);
});

test("Notification requires a schedule", () => {
  const error = validationErrorFor({ scheduled_for: undefined });
  assert.ok(error.errors.scheduled_for);
});

test("Notification delivery and read timestamps default to null", () => {
  const notification = new Notification(validNotification());
  assert.equal(notification.delivered_at, null);
  assert.equal(notification.read_at, null);
  assert.equal(notification.active, true);
});

test("Notification enables timestamps and expected indexes", () => {
  const schema = Notification.schema;
  assert.equal(schema.options.timestamps, true);
  assert.ok(hasIndex(schema, { user: 1 }));
  assert.ok(hasIndex(schema, { recommendation: 1 }));
  assert.ok(hasIndex(schema, { scheduled_for: 1 }));
  assert.ok(
    hasIndex(
      schema,
      { recommendation: 1, type: 1 },
      { unique: true }
    )
  );
});
