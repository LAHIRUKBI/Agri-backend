const MARKET_OUTLOOK_STATUSES = Object.freeze({
  UPWARD: "UPWARD",
  DOWNWARD: "DOWNWARD",
  MIXED: "MIXED",
  STABLE: "STABLE",
  LIMITED: "LIMITED",
});

const SIGNAL_ALIGNMENTS = Object.freeze({
  ALIGNED: "ALIGNED",
  CONFLICT: "CONFLICT",
  STABLE: "STABLE",
  UNKNOWN: "UNKNOWN",
});

const CONFIDENCE_STRENGTHS = Object.freeze({
  LOW: "LOW",
  MODERATE: "MODERATE",
  STRONG: "STRONG",
});

const toFiniteNumber = (value) => {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizePriceSignal = (value) => {
  const signal = String(value || "").trim().toUpperCase();
  return ["UP", "DOWN", "STABLE"].includes(signal) ? signal : null;
};

const normalizeDirectionSignal = (value) => {
  const signal = String(value || "").trim().toUpperCase();
  return ["UP", "DOWN"].includes(signal) ? signal : null;
};

// These are the existing controller confidence boundaries, shared here so
// direction presentation and market-outlook interpretation cannot diverge.
const getConfidenceStrength = (probability) => {
  const safeProbability = toFiniteNumber(probability) ?? 0;

  if (safeProbability < 0.6) return CONFIDENCE_STRENGTHS.LOW;
  if (safeProbability < 0.75) return CONFIDENCE_STRENGTHS.MODERATE;
  return CONFIDENCE_STRENGTHS.STRONG;
};

const getDirectionalSummary = (status, strength) => {
  const direction = status === MARKET_OUTLOOK_STATUSES.UPWARD
    ? "upward"
    : "downward";

  if (strength === CONFIDENCE_STRENGTHS.LOW) {
    return `Both experimental signals point ${direction}, but confidence is low.`;
  }

  if (strength === CONFIDENCE_STRENGTHS.MODERATE) {
    return `Both experimental signals point ${direction} with moderate confidence.`;
  }

  return `Both experimental signals point ${direction} with strong confidence.`;
};

const buildMarketOutlook = ({
  priceSignal,
  directionSignal,
  confidence,
}) => {
  const normalizedPriceSignal = normalizePriceSignal(priceSignal);
  const normalizedDirectionSignal = normalizeDirectionSignal(directionSignal);
  const safeConfidence = toFiniteNumber(confidence);
  const strength = getConfidenceStrength(safeConfidence);
  let status = MARKET_OUTLOOK_STATUSES.LIMITED;
  let signalAlignment = SIGNAL_ALIGNMENTS.UNKNOWN;
  let summary =
    "Not enough model evidence is available for a clear market outlook.";

  if (normalizedPriceSignal && normalizedDirectionSignal) {
    if (normalizedPriceSignal === "STABLE") {
      status = MARKET_OUTLOOK_STATUSES.STABLE;
      signalAlignment = SIGNAL_ALIGNMENTS.STABLE;
      summary =
        "The experimental price estimate is close to the current price, so there is no clear price edge.";
    } else if (normalizedPriceSignal === normalizedDirectionSignal) {
      status = normalizedPriceSignal === "UP"
        ? MARKET_OUTLOOK_STATUSES.UPWARD
        : MARKET_OUTLOOK_STATUSES.DOWNWARD;
      signalAlignment = SIGNAL_ALIGNMENTS.ALIGNED;
      summary = getDirectionalSummary(status, strength);
    } else {
      status = MARKET_OUTLOOK_STATUSES.MIXED;
      signalAlignment = SIGNAL_ALIGNMENTS.CONFLICT;
      summary =
        "The experimental price estimate and direction classifier point in different directions.";
    }
  }

  return {
    status,
    strength,
    signal_alignment: signalAlignment,
    price_signal: normalizedPriceSignal,
    direction_signal: normalizedDirectionSignal,
    confidence: safeConfidence,
    summary,
  };
};

module.exports = {
  CONFIDENCE_STRENGTHS,
  MARKET_OUTLOOK_STATUSES,
  SIGNAL_ALIGNMENTS,
  buildMarketOutlook,
  getConfidenceStrength,
};
