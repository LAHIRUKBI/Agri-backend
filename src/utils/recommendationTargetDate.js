const DAY_MS = 24 * 60 * 60 * 1000;
const PREDICTION_HORIZON_DAYS = 7;
const DUE_SOON_LEAD_DAYS = 1;

const toValidDate = (value) => {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "string" && value.trim()
        ? new Date(value)
        : null;

  if (!date || !Number.isFinite(date.getTime())) {
    throw new TypeError("A valid Date or ISO date string is required");
  }

  return date;
};

const calculatePredictionTargetDate = (baseDate) => {
  const base = toValidDate(baseDate);
  return new Date(base.getTime() + PREDICTION_HORIZON_DAYS * DAY_MS);
};

const calculateDueSoonDate = (targetDate) => {
  const target = toValidDate(targetDate);
  return new Date(target.getTime() - DUE_SOON_LEAD_DAYS * DAY_MS);
};

const buildRecommendationSchedule = (baseDate) => {
  const predictionTargetDate = calculatePredictionTargetDate(baseDate);

  return {
    predictionTargetDate,
    dueSoonDate: calculateDueSoonDate(predictionTargetDate),
    dueDate: new Date(predictionTargetDate.getTime()),
  };
};

module.exports = {
  DAY_MS,
  calculatePredictionTargetDate,
  calculateDueSoonDate,
  buildRecommendationSchedule,
};
