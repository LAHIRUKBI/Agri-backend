const Groq = require("groq-sdk");

const INSIGHT_FIELDS = [
  "recommendation",
  "prediction_summary",
  "price_movement",
  "prediction_strength",
  "why_this_matters",
  "suggested_action",
];

const GROQ_TIMEOUT_MS = 10000;

const getMarketName = (market) => market?.market || "the recommended market";

const getFirstFiniteNumber = (source, fields) => {
  for (const field of fields) {
    const value = Number(source?.[field]);
    if (Number.isFinite(value)) {
      return value;
    }
  }

  return null;
};

const getEstimatedCurrentEarnings = (market) =>
  getFirstFiniteNumber(market, [
    "estimated_earnings",
    "estimated_earning",
    "estimated_earnings_rs",
    "estimated_earning_rs",
    "estimated_revenue",
    "estimated_return",
    "expected_return",
    "net_earning",
    "gross_earning",
    "current_price_rs_kg",
    "reference_price_rs_kg",
    "current_price",
  ]);

const getEstimatedFutureEarnings = (market) =>
  getFirstFiniteNumber(market, [
    "estimated_future_earnings",
    "estimated_future_earning",
    "estimated_future_earnings_rs",
    "future_estimated_earnings",
    "future_estimate",
    "estimated_future_price_rs_kg",
    "future_price_rs_kg",
    "predicted_price_rs_kg",
  ]);

const getComparisonValue = (market) =>
  getEstimatedFutureEarnings(market) ?? getEstimatedCurrentEarnings(market);

const getTrendText = (market) => {
  const upProbability = Number(market?.up_probability);
  const downProbability = Number(market?.down_probability);

  if (!Number.isFinite(upProbability) || !Number.isFinite(downProbability)) {
    return "an uncertain trend";
  }

  if (upProbability > downProbability) {
    return "a possible upward trend";
  }

  if (downProbability > upProbability) {
    return "a possible downward trend";
  }

  return "a balanced trend";
};

const hasExactNumber = (value) => /(?:\b(?:rs|lkr)\b|\d)/i.test(value);

const SELL_NOW_ACTION_LANGUAGE_PATTERNS = [
  /\bsell\b[^.!?\n]{0,40}\b(?:now|immediately|before)\b/i,
];

const WAIT_ACTION_LANGUAGE_PATTERNS = [
  /\bwait\b/i,
  /\bhold\b/i,
  /\b(?:delay|postpone)\s+(?:the\s+)?(?:sale|selling)\b/i,
];

const getCanonicalActionDecision = (recommendationData) =>
  String(
    recommendationData?.actionDecision ||
      recommendationData?.recommendedMarket?.action_decision ||
      "UNCERTAIN"
  ).toUpperCase();

const violatesActionLanguagePolicy = (value, canonicalActionDecision) => {
  const containsSellNow = SELL_NOW_ACTION_LANGUAGE_PATTERNS.some((pattern) =>
    pattern.test(value)
  );
  const containsWait = WAIT_ACTION_LANGUAGE_PATTERNS.some((pattern) =>
    pattern.test(value)
  );

  if (canonicalActionDecision === "WAIT") return containsSellNow;
  if (canonicalActionDecision === "SELL_NOW") return containsWait;
  return containsSellNow || containsWait;
};

const getFallbackWeatherMessages = (weatherContext) => {
  const rainfallRisk = String(weatherContext?.rainfall_risk || "").toUpperCase();

  if (rainfallRisk === "HIGH") {
    return {
      whyThisMatters:
        "Heavy rainfall is forecast for the coming market period and may make harvesting, farm access, transport, handling, or safe storage more difficult.",
      suggestedAction:
        "Protect exposed produce, arrange transport early, confirm buyer availability, and secure storage while monitoring forecast changes.",
    };
  }

  if (rainfallRisk === "MODERATE") {
    return {
      whyThisMatters:
        "Some rainfall risk is forecast for the coming market period, so routine harvesting and transport preparation may be helpful.",
      suggestedAction:
        "Check access, transport, produce protection, and storage arrangements while monitoring forecast changes.",
    };
  }

  return null;
};

const createFallbackInsights = ({
  input,
  primaryMappedMarket,
  bestPredictedMarket,
  recommendedMarket,
  actionDecision,
  comparisonStrength,
  isCloseCall,
  weatherContext,
}) => {
  const crop = input?.crop || "this crop";
  const farmerDistrict =
    input?.farmer_district || input?.district || "the farmer district";
  const primaryMappedMarketName = getMarketName(primaryMappedMarket);
  const bestMarketName = getMarketName(bestPredictedMarket);
  const prediction = String(bestPredictedMarket?.prediction || "uncertain").toLowerCase();
  const trendText = getTrendText(bestPredictedMarket);
  const weakConfidence = comparisonStrength !== "strong" || isCloseCall;
  const canonicalDecision =
    actionDecision || recommendedMarket?.action_decision || "UNCERTAIN";
  const canonicalDecisionText = String(canonicalDecision)
    .replace(/_/g, " ")
    .toLowerCase();

  const recommendation = `For ${crop} in ${farmerDistrict}, ${primaryMappedMarketName} remains the policy-preferred mapped option while the learned-model comparison with ${bestMarketName} stays experimental.`;

  const predictionStrength = weakConfidence
    ? `For ${crop} in ${farmerDistrict}, this has weak confidence and should be treated as guidance, not a firm decision.`
    : `For ${crop} in ${farmerDistrict}, ${bestMarketName} shows a stronger trend signal, but it is still only guidance.`;

  const suggestedAction = `Check current buyer offers, actual logistics, storage, and spoilage conditions before choosing when or where to sell.`;
  const weatherMessages = getFallbackWeatherMessages(weatherContext);

  return {
    recommendation,
    prediction_summary: `${bestMarketName} shows ${trendText}, while ${primaryMappedMarketName} remains the policy-preferred mapped option for ${crop} in ${farmerDistrict}.`,
    price_movement: `The experimental price direction for ${bestMarketName} is predicted as ${prediction}, while the canonical selling guidance remains ${canonicalDecisionText}.`,
    prediction_strength: predictionStrength,
    why_this_matters:
      weatherMessages?.whyThisMatters ||
      `${primaryMappedMarketName} and ${bestMarketName} are mapped markets available for comparison for farmers in ${farmerDistrict}.`,
    suggested_action:
      weatherMessages?.suggestedAction || suggestedAction,
  };
};

const sanitizeInsights = (
  insights,
  fallbackInsights,
  recommendationData = {}
) => {
  if (!insights || typeof insights !== "object" || Array.isArray(insights)) {
    return fallbackInsights;
  }

  const canonicalActionDecision = getCanonicalActionDecision(recommendationData);

  return INSIGHT_FIELDS.reduce((cleaned, field) => {
    const value = insights[field];
    const trimmedValue = typeof value === "string" ? value.trim() : "";
    cleaned[field] =
      trimmedValue &&
      !hasExactNumber(trimmedValue) &&
      !violatesActionLanguagePolicy(
        trimmedValue,
        canonicalActionDecision
      )
        ? trimmedValue
        : fallbackInsights[field];
    return cleaned;
  }, {});
};

const parseJsonContent = (content) => {
  if (!content || typeof content !== "string") {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    try {
      return JSON.parse(jsonMatch[0]);
    } catch (nestedError) {
      return null;
    }
  }
};

const withTimeout = (promise, timeoutMs) =>
  Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error("Groq insight generation timed out")), timeoutMs);
    }),
  ]);

const buildPrompt = ({
  input,
  primaryMappedMarket,
  bestPredictedMarket,
  recommendedMarket,
  actionDecision,
  comparisons,
  comparisonStrength,
  comparisonNote,
  isCloseCall,
  probabilityDelta,
  weatherContext,
}) => {
  const primaryMappedCurrentEarnings =
    getEstimatedCurrentEarnings(primaryMappedMarket);
  const bestCurrentEarnings = getEstimatedCurrentEarnings(bestPredictedMarket);
  const primaryMappedFutureEarnings =
    getEstimatedFutureEarnings(primaryMappedMarket);
  const bestFutureEarnings = getEstimatedFutureEarnings(bestPredictedMarket);
  const primaryMappedComparisonValue = getComparisonValue(primaryMappedMarket);
  const bestComparisonValue = getComparisonValue(bestPredictedMarket);
  const marketDifference =
    Number.isFinite(bestComparisonValue) &&
    Number.isFinite(primaryMappedComparisonValue)
      ? bestComparisonValue - primaryMappedComparisonValue
      : null;
  const insightContext = {
    crop: input?.crop,
    farmer_district: input?.farmer_district || input?.district,
    prediction_horizon: input?.horizon,
    canonical_action_decision:
      actionDecision || recommendedMarket?.action_decision || "UNCERTAIN",
    canonical_action_authorized: ["WAIT", "SELL_NOW"].includes(
      String(
        actionDecision || recommendedMarket?.action_decision || "UNCERTAIN"
      ).toUpperCase()
    ),
    market_comparison_model_action_authorized: false,
    weather_context: weatherContext || null,
    primary_mapped_market: {
      ...primaryMappedMarket,
      estimated_current_earnings: primaryMappedCurrentEarnings,
      estimated_future_earnings: primaryMappedFutureEarnings,
    },
    best_predicted_market: {
      ...bestPredictedMarket,
      estimated_current_earnings: bestCurrentEarnings,
      estimated_future_earnings: bestFutureEarnings,
    },
    difference_between_primary_mapped_and_best_predicted_market:
      marketDifference,
    comparison_strength: comparisonStrength,
    comparison_note: comparisonNote,
    is_close_call: isCloseCall,
    probability_delta: probabilityDelta,
    comparisons: comparisons.map((item) => ({
      market: item.market,
      prediction: item.prediction,
      up_probability: item.up_probability,
      down_probability: item.down_probability,
      current_price_rs_kg: item.current_price_rs_kg,
      estimated_current_earnings: getEstimatedCurrentEarnings(item),
      estimated_future_earnings: getEstimatedFutureEarnings(item),
      comparison_quality: item.comparison_quality,
      reliable_for_comparison: item.reliable_for_comparison,
      excluded_from_best_market: item.excluded_from_best_market,
    })),
  };

  return `You are an agricultural market assistant helping Sri Lankan farmers make crop selling decisions.

Use the numeric values below only to choose the correct qualitative message.
Do not write any exact numeric values in the final JSON text.

Recommendation data:
${JSON.stringify(insightContext, null, 2)}

Your job:
Generate a clear, practical, farmer-friendly recommendation.

STRICT RULES:

1. The final AI explanation must NOT include exact numeric values.
Do NOT include:
- rupee amounts
- percentages
- exact price changes
- exact earning differences
- exact time-based price increase values

2. Always mention:
- crop name
- farmer district
- primary mapped market name
- alternative or best predicted market name

3. Use qualitative language only:
- higher estimated earning
- lower estimated earning
- better practical option
- stronger trend signal
- small difference
- weak confidence
- moderate confidence
- market conditions

4. Never guarantee future prices or profit.
Use words like:
- may
- possible
- estimated
- likely
- guidance

5. Do NOT say "best price" unless that market has the highest estimated earnings.

6. If the primary mapped market has higher estimated earning:
- Say the primary mapped market is the policy-preferred available mapped option.
- Mention the alternative market only as having a possible trend signal if relevant.
- Do not infer distance, transport cost, or transport risk from mapping order.

7. If the best predicted market has higher estimated earning:
- Say the best predicted market may offer a better opportunity.
- Still mention the farmer should verify actual logistics and buyer conditions.

8. If the best predicted market has lower estimated earning:
- Say it may have a stronger trend signal, but lower estimated earning.
- Do not strongly recommend that lower-return market.

9. If market probabilities or estimated earnings are very close:
- Clearly say the difference is small.
- Keep the primary mapped market as the policy-preferred mapped option.

10. If confidence is weak:
- Clearly say the result should be treated as guidance, not a firm decision.
- Avoid strong wording such as "definitely", "clearly best", or "guaranteed".

11. If confidence is moderate:
- Say the prediction gives useful guidance, but the farmer should still compare real market conditions.

12. If confidence is strong:
- You may say the market shows a stronger signal, but still do not guarantee the outcome.

13. Do not contradict the numeric values provided.
Your recommendation must match the estimated earnings, market comparison, and probabilities.

14. Make the text sound personalized and context-aware, not rule-based.

15. Avoid repeating the same idea in recommendation and suggested_action.
Make them complementary:
- recommendation = main conclusion
- suggested_action = practical next step

16. Keep language simple and farmer-friendly.
Use short sentences.
Avoid technical ML terms unless necessary.

17. Do not use "Next Week Estimate" wording.
Use "future estimate" or refer to the selected prediction horizon without writing numbers.

18. Keep each field concise.
Each field should be one to two short sentences only.

19. Return ONLY valid JSON.
No markdown.
No bullet points outside JSON.
No extra explanation.

20. The canonical price action decision is authoritative.
- Never change canonical_action_decision or independently derive another selling action.
- When it is WAIT, you may explain waiting but must not recommend SELL_NOW.
- When it is SELL_NOW, you may explain selling now but must not recommend WAIT, holding, or delaying the sale.
- When it is UNCERTAIN, do not tell the farmer to wait or sell now.
- The market-comparison classifier is experimental comparison evidence and is not action-authorized.
- Keep the primary mapped market as the policy-preferred mapped option; do not redirect the farmer using the experimental model.

21. Candidate-market order is a backend policy mapping, not geographic evidence.
- Never call a mapped market nearest, closest, or nearby.
- Never claim or imply lower transport cost, transport savings, or lower transport risk.
- Use neutral wording such as "available mapped market" or "market available for comparison".

WEATHER RULES:

- Use only the supplied weather_context.
- Never invent rainfall amounts, probabilities, locations, or risk levels.
- Do not recalculate rainfall_risk.
- Weather is an operational advisory only.
- Never claim rainfall guarantees a price increase or decrease.
- Never say rainfall caused the experimental price estimate.
- Weather must never override canonical_action_decision.
- If weather_context is null, omit weather advice completely.
- For HIGH rainfall risk, mention possible harvesting, farm-access, transport, handling, or spoilage difficulties.
- For MODERATE rainfall risk, suggest practical preparation without alarmist wording.
- For LOW rainfall risk, avoid unnecessary weather warnings.
- Do not describe forecast weather as historical or observed weather.
- When canonical_action_decision is UNCERTAIN, do not instruct the farmer to sell now, sell immediately, sell before rainfall, wait, hold, or delay selling.
- For UNCERTAIN, limit weather advice to operational preparation such as arranging transport early, protecting exposed produce, confirming buyer availability, securing storage, or monitoring forecast changes.

OUTPUT FORMAT:

{
  "recommendation": "...",
  "prediction_summary": "...",
  "price_movement": "...",
  "prediction_strength": "...",
  "why_this_matters": "...",
  "suggested_action": "..."
}
`;
};

const generateGroqInsights = async (recommendationData) => {
  const fallbackInsights = createFallbackInsights(recommendationData);
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey || apiKey === "your_groq_api_key_here") {
    return fallbackInsights;
  }

  try {
    const groq = new Groq({ apiKey });
    const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
    const completion = await withTimeout(
      groq.chat.completions.create({
        model,
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write careful agricultural market insights. Return valid JSON only, never include exact numeric values in user-facing text, use only supplied forecast data, and never override the canonical action decision.",
          },
          {
            role: "user",
            content: buildPrompt(recommendationData),
          },
        ],
      }),
      GROQ_TIMEOUT_MS
    );

    const content = completion?.choices?.[0]?.message?.content;
    const parsedInsights = parseJsonContent(content);
    return sanitizeInsights(
      parsedInsights,
      fallbackInsights,
      recommendationData
    );
  } catch (error) {
    return fallbackInsights;
  }
};

module.exports = {
  generateGroqInsights,
  buildPrompt,
  createFallbackInsights,
  sanitizeInsights,
};
