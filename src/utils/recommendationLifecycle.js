const { DAY_MS } = require("./recommendationTargetDate");

const toValidDate = (value, fieldName) => {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null;

  if (!date || !Number.isFinite(date.getTime())) {
    throw new TypeError(`${fieldName} must be a valid date`);
  }

  return date;
};

const getEffectiveRecommendationStatus = ({
  storedStatus,
  predictionTargetDate,
  now = new Date(),
}) => {
  if (storedStatus === "ARCHIVED") return "ARCHIVED";

  const target = toValidDate(
    predictionTargetDate,
    "predictionTargetDate"
  );
  const currentTime = toValidDate(now, "now");

  if (currentTime.getTime() >= target.getTime()) return "DUE";
  if (currentTime.getTime() >= target.getTime() - DAY_MS) return "DUE_SOON";
  return "ACTIVE";
};

module.exports = {
  getEffectiveRecommendationStatus,
};
