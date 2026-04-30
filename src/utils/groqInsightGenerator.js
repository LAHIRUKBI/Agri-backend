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
const CLOSE_EARNING_DELTA = 2;

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

const findHighestEarningMarket = (markets) =>
  markets.reduce((highest, market) => {
    const earnings = getComparisonValue(market);
    if (!Number.isFinite(earnings)) {
      return highest;
    }

    if (!highest || earnings > highest.earnings) {
      return { market, earnings };
    }

    return highest;
  }, null);

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

const hasExactNumber = (value) => /(?:rs\.?|lkr|\d)/i.test(value);

const createFallbackInsights = ({
  input,
  nearestMarket,
  bestPredictedMarket,
  comparisonStrength,
  isCloseCall,
  comparisons = [],
}) => {
  const crop = input?.crop || "this crop";
  const district = input?.district || "the farmer district";
  const nearestMarketName = getMarketName(nearestMarket);
  const bestMarketName = getMarketName(bestPredictedMarket);
  const prediction = String(bestPredictedMarket?.prediction || "uncertain").toLowerCase();
  const trendText = getTrendText(bestPredictedMarket);
  const bestComparisonValue = getComparisonValue(bestPredictedMarket);
  const nearestComparisonValue = getComparisonValue(nearestMarket);
  const earningsDifference =
    Number.isFinite(bestComparisonValue) && Number.isFinite(nearestComparisonValue)
      ? bestComparisonValue - nearestComparisonValue
      : null;
  const highestEarningMarket = findHighestEarningMarket([
    nearestMarket,
    bestPredictedMarket,
    ...comparisons,
  ]);
  const bestHasHighestKnownEarnings =
    highestEarningMarket?.market?.market === bestPredictedMarket?.market;
  const nearestHasHighestKnownEarnings =
    highestEarningMarket?.market?.market === nearestMarket?.market;
  const bestHasLowerKnownEarnings =
    Number.isFinite(bestComparisonValue) &&
    Number.isFinite(nearestComparisonValue) &&
    bestComparisonValue < nearestComparisonValue;
  const earningsAreClose =
    Number.isFinite(earningsDifference) &&
    Math.abs(earningsDifference) <= CLOSE_EARNING_DELTA;
  const weakConfidence = comparisonStrength !== "strong" || isCloseCall;

  const recommendation = isCloseCall || earningsAreClose
    ? `For ${crop} in ${district}, ${nearestMarketName} may be safer because it is close to ${bestMarketName}.`
    : nearestHasHighestKnownEarnings
      ? `For ${crop} in ${district}, ${nearestMarketName} may be the more practical option than ${bestMarketName}.`
      : bestHasHighestKnownEarnings
        ? `For ${crop} in ${district}, ${bestMarketName} may offer a better opportunity than ${nearestMarketName}.`
        : bestHasLowerKnownEarnings
          ? `For ${crop} in ${district}, ${nearestMarketName} may be more practical than ${bestMarketName} because the alternative has lower estimated earning.`
          : `For ${crop} in ${district}, compare ${nearestMarketName} with ${bestMarketName} before deciding.`;

  const predictionStrength = weakConfidence
    ? `For ${crop} in ${district}, this has weak confidence and should be treated as guidance, not a firm decision.`
    : `For ${crop} in ${district}, ${bestMarketName} shows a stronger trend signal, but it is still only guidance.`;

  const suggestedAction = isCloseCall || earningsAreClose
    ? `Check buyer offers first, but ${nearestMarketName} may reduce transport cost and selling risk compared with ${bestMarketName}.`
    : nearestHasHighestKnownEarnings
      ? `Compare real market conditions, but ${nearestMarketName} may reduce transport cost, selling cost, and risk.`
      : bestHasHighestKnownEarnings
        ? `Before choosing ${bestMarketName}, compare transport cost and selling cost with ${nearestMarketName}.`
        : `Check buyer demand in ${nearestMarketName} and ${bestMarketName} before selling.`;

  return {
    recommendation,
    prediction_summary: `${bestMarketName} shows ${trendText}, while ${nearestMarketName} remains the nearest option for ${crop} in ${district}.`,
    price_movement: `The price direction for ${bestMarketName} is predicted as ${prediction}, but future prices may change with market conditions.`,
    prediction_strength: predictionStrength,
    why_this_matters: `${nearestMarketName} affects practical selling cost for farmers in ${district}, while ${bestMarketName} may show a different earning opportunity for ${crop}.`,
    suggested_action: suggestedAction,
  };
};

const sanitizeInsights = (insights, fallbackInsights) => {
  if (!insights || typeof insights !== "object" || Array.isArray(insights)) {
    return fallbackInsights;
  }

  return INSIGHT_FIELDS.reduce((cleaned, field) => {
    const value = insights[field];
    const trimmedValue = typeof value === "string" ? value.trim() : "";
    cleaned[field] =
      trimmedValue && !hasExactNumber(trimmedValue)
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
  nearestMarket,
  bestPredictedMarket,
  comparisons,
  comparisonStrength,
  comparisonNote,
  isCloseCall,
  probabilityDelta,
}) => {
  const nearestCurrentEarnings = getEstimatedCurrentEarnings(nearestMarket);
  const bestCurrentEarnings = getEstimatedCurrentEarnings(bestPredictedMarket);
  const nearestFutureEarnings = getEstimatedFutureEarnings(nearestMarket);
  const bestFutureEarnings = getEstimatedFutureEarnings(bestPredictedMarket);
  const nearestComparisonValue = getComparisonValue(nearestMarket);
  const bestComparisonValue = getComparisonValue(bestPredictedMarket);
  const marketDifference =
    Number.isFinite(bestComparisonValue) && Number.isFinite(nearestComparisonValue)
      ? bestComparisonValue - nearestComparisonValue
      : null;
  const insightContext = {
    crop: input?.crop,
    farmer_district: input?.district,
    prediction_horizon: input?.horizon,
    nearest_market: {
      ...nearestMarket,
      estimated_current_earnings: nearestCurrentEarnings,
      estimated_future_earnings: nearestFutureEarnings,
    },
    best_predicted_market: {
      ...bestPredictedMarket,
      estimated_current_earnings: bestCurrentEarnings,
      estimated_future_earnings: bestFutureEarnings,
    },
    difference_between_nearest_and_best_predicted_market: marketDifference,
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
- nearest market name
- alternative or best predicted market name

3. Use qualitative language only:
- higher estimated earning
- lower estimated earning
- better practical option
- stronger trend signal
- small difference
- weak confidence
- moderate confidence
- transport cost
- selling cost
- market conditions

4. Never guarantee future prices or profit.
Use words like:
- may
- possible
- estimated
- likely
- guidance

5. Do NOT say "best price" unless that market has the highest estimated earnings.

6. If the nearest market has higher estimated earning:
- Say the nearest market is the more practical option.
- Mention the alternative market only as having a possible trend signal if relevant.
- Mention that the nearest market may reduce transport cost, selling cost, and risk.

7. If the best predicted market has higher estimated earning:
- Say the best predicted market may offer a better opportunity.
- Still mention the farmer should consider transport and selling costs.

8. If the best predicted market has lower estimated earning:
- Say it may have a stronger trend signal, but lower estimated earning.
- Do not strongly recommend that lower-return market.

9. If market probabilities or estimated earnings are very close:
- Clearly say the difference is small.
- Recommend the nearest market as the safer or more practical choice.

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
    const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
    const completion = await withTimeout(
      groq.chat.completions.create({
        model,
        temperature: 0.2,
        max_tokens: 500,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write careful agricultural market insights. Return valid JSON only and never include exact numeric values in user-facing text.",
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
    return sanitizeInsights(parsedInsights, fallbackInsights);
  } catch (error) {
    return fallbackInsights;
  }
};

module.exports = {
  generateGroqInsights,
};
