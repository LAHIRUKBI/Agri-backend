const test = require("node:test");
const assert = require("node:assert/strict");

const {
  canonicalizeRecommendationFingerprintInput,
  generateRecommendationFingerprint,
} = require("../../src/utils/recommendationFingerprint");

const validInput = (overrides = {}) => ({
  userId: "507f1f77bcf86cd799439011",
  recommendationTimestamp: "2026-08-26T04:30:00.000Z",
  crop: "beans",
  recommendedMarket: "kandy",
  currentPrice: 200,
  experimentalPrice: 215,
  ...overrides,
});

test("same normalized recommendation produces the same fingerprint", () => {
  const first = generateRecommendationFingerprint(validInput());
  const second = generateRecommendationFingerprint(validInput());
  assert.equal(first, second);
});

test("crop and market casing and outer whitespace are normalized", () => {
  const normalized = generateRecommendationFingerprint(validInput());
  const varied = generateRecommendationFingerprint(
    validInput({
      userId: " 507f1f77bcf86cd799439011 ",
      crop: "  BEANS ",
      recommendedMarket: " KANDY  ",
    })
  );

  assert.equal(normalized, varied);
});

test("equivalent timestamp representations are canonicalized", () => {
  const utc = generateRecommendationFingerprint(validInput());
  const offset = generateRecommendationFingerprint(
    validInput({ recommendationTimestamp: "2026-08-26T10:00:00+05:30" })
  );
  assert.equal(utc, offset);
});

test("same displayed recommendation remains idempotent", () => {
  const displayedRecommendation = validInput();
  assert.equal(
    generateRecommendationFingerprint(displayedRecommendation),
    generateRecommendationFingerprint({ ...displayedRecommendation })
  );
});

test("identity field changes produce different fingerprints", () => {
  const base = generateRecommendationFingerprint(validInput());
  const variants = [
    { userId: "507f191e810c19729de860ea" },
    { recommendationTimestamp: "2026-08-26T04:30:01.000Z" },
    { crop: "carrot" },
    { recommendedMarket: "dambulla" },
    { currentPrice: 201 },
    { experimentalPrice: 216 },
  ];

  for (const variant of variants) {
    assert.notEqual(
      generateRecommendationFingerprint(validInput(variant)),
      base
    );
  }
});

test("missing experimental price canonicalizes explicitly to null", () => {
  const withNull = generateRecommendationFingerprint(
    validInput({ experimentalPrice: null })
  );
  const omitted = generateRecommendationFingerprint(
    validInput({ experimentalPrice: undefined })
  );

  assert.equal(withNull, omitted);
  assert.equal(
    canonicalizeRecommendationFingerprintInput(
      validInput({ experimentalPrice: undefined })
    ).experimentalPrice,
    null
  );
});

test("invalid timestamps are rejected", () => {
  assert.throws(
    () =>
      generateRecommendationFingerprint(
        validInput({ recommendationTimestamp: "not-a-date" })
      ),
    /recommendationTimestamp must be a valid date/
  );
});

test("missing required fields are rejected", () => {
  for (const field of [
    "userId",
    "recommendationTimestamp",
    "crop",
    "recommendedMarket",
    "currentPrice",
  ]) {
    assert.throws(() => {
      const input = validInput();
      delete input[field];
      generateRecommendationFingerprint(input);
    });
  }
});

test("invalid prices are rejected", () => {
  for (const currentPrice of [0, -1, Infinity, "200"]) {
    assert.throws(() =>
      generateRecommendationFingerprint(validInput({ currentPrice }))
    );
  }

  for (const experimentalPrice of [-1, Infinity, "215"]) {
    assert.throws(() =>
      generateRecommendationFingerprint(validInput({ experimentalPrice }))
    );
  }
});

test("fingerprint is lowercase 64-character SHA-256 hex", () => {
  const fingerprint = generateRecommendationFingerprint(validInput());
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
});

test("fingerprint generation does not mutate input", () => {
  const input = validInput({
    crop: " Beans ",
    recommendedMarket: " Kandy ",
  });
  const original = structuredClone(input);

  generateRecommendationFingerprint(input);
  assert.deepEqual(input, original);
});
