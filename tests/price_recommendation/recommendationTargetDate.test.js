const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculatePredictionTargetDate,
  calculateDueSoonDate,
  buildRecommendationSchedule,
} = require("../../src/utils/recommendationTargetDate");

test("target date is exactly seven elapsed days after the base date", () => {
  const target = calculatePredictionTargetDate(
    new Date("2026-08-26T04:30:00.000Z")
  );
  assert.equal(target.toISOString(), "2026-09-02T04:30:00.000Z");
});

test("due-soon date is exactly 24 hours before the target date", () => {
  const dueSoon = calculateDueSoonDate(
    new Date("2026-09-02T04:30:00.000Z")
  );
  assert.equal(dueSoon.toISOString(), "2026-09-01T04:30:00.000Z");
});

test("schedule due date equals its prediction target date", () => {
  const schedule = buildRecommendationSchedule(
    "2026-08-26T04:30:00.000Z"
  );

  assert.equal(
    schedule.predictionTargetDate.toISOString(),
    "2026-09-02T04:30:00.000Z"
  );
  assert.equal(
    schedule.dueSoonDate.toISOString(),
    "2026-09-01T04:30:00.000Z"
  );
  assert.equal(schedule.dueDate.toISOString(), "2026-09-02T04:30:00.000Z");
  assert.notEqual(schedule.dueDate, schedule.predictionTargetDate);
});

test("date calculations do not mutate their inputs", () => {
  const base = new Date("2026-08-26T04:30:00.000Z");
  const originalTime = base.getTime();
  calculatePredictionTargetDate(base);
  assert.equal(base.getTime(), originalTime);

  const target = new Date("2026-09-02T04:30:00.000Z");
  const targetTime = target.getTime();
  calculateDueSoonDate(target);
  assert.equal(target.getTime(), targetTime);
});

test("invalid dates are rejected", () => {
  assert.throws(
    () => calculatePredictionTargetDate("not-a-date"),
    /valid Date or ISO date string/
  );
  assert.throws(
    () => calculatePredictionTargetDate(new Date(Number.NaN)),
    /valid Date or ISO date string/
  );
});

test("target calculation crosses month boundaries", () => {
  const target = calculatePredictionTargetDate("2026-08-29T00:00:00.000Z");
  assert.equal(target.toISOString(), "2026-09-05T00:00:00.000Z");
});

test("target calculation crosses year boundaries", () => {
  const target = calculatePredictionTargetDate("2026-12-29T00:00:00.000Z");
  assert.equal(target.toISOString(), "2027-01-05T00:00:00.000Z");
});
