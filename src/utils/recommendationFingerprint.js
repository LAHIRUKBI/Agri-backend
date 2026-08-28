const crypto = require("crypto");

const requireNormalizedText = (value, fieldName, { lowercase = false } = {}) => {
  if (typeof value !== "string") {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }

  return lowercase ? normalized.toLowerCase() : normalized;
};

const normalizeUserId = (value) => {
  const rawValue =
    value && typeof value.toHexString === "function"
      ? value.toHexString()
      : value;

  return requireNormalizedText(rawValue, "userId");
};

const normalizeTimestamp = (value) => {
  const timestamp =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null;

  if (!timestamp || !Number.isFinite(timestamp.getTime())) {
    throw new TypeError("recommendationTimestamp must be a valid date");
  }

  return timestamp.toISOString();
};

const requireCurrentPrice = (value) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError("currentPrice must be a finite number greater than 0");
  }

  return value;
};

const normalizeExperimentalPrice = (value) => {
  if (value == null) return null;

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(
      "experimentalPrice must be null or a finite non-negative number"
    );
  }

  return value;
};

const canonicalizeRecommendationFingerprintInput = (input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("fingerprint input must be an object");
  }

  return {
    userId: normalizeUserId(input.userId),
    recommendationTimestamp: normalizeTimestamp(
      input.recommendationTimestamp
    ),
    crop: requireNormalizedText(input.crop, "crop", { lowercase: true }),
    recommendedMarket: requireNormalizedText(
      input.recommendedMarket,
      "recommendedMarket",
      { lowercase: true }
    ),
    currentPrice: requireCurrentPrice(input.currentPrice),
    experimentalPrice: normalizeExperimentalPrice(input.experimentalPrice),
  };
};

const generateRecommendationFingerprint = (input) => {
  const canonicalInput = canonicalizeRecommendationFingerprintInput(input);

  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalInput), "utf8")
    .digest("hex");
};

module.exports = {
  canonicalizeRecommendationFingerprintInput,
  generateRecommendationFingerprint,
};
