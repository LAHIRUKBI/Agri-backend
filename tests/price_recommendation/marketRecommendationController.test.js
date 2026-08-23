const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const groqInsightGenerator = require("../../src/utils/groqInsightGenerator");
const weatherForecastService = require("../../src/services/weatherForecastService");

process.env.GROQ_API_KEY = "";
const {
  recommendBestMarket,
} = require("../../src/controllers/marketRecommendationController");

const makeResponse = () => {
  const state = { statusCode: null, body: null };
  return {
    state,
    status(code) {
      state.statusCode = code;
      return this;
    },
    json(body) {
      state.body = body;
      return body;
    },
  };
};

const fakeMlResponse = (payload) => {
  const price = payload.current_price_source === "system"
    ? payload.market === "meegoda" ? 448 : 424
    : payload.price_rs_kg;
  const predicted = payload.market === "meegoda" ? 425.6 : 418.27;

  return {
    data: {
      prediction: "DOWN",
      probabilities: { DOWN: 0.56, UP: 0.44 },
      predicted_price_rs_kg: predicted,
      price_prediction_source: "regression_model",
      price_model_metrics: { mae: 63.84 },
      current_price_source: payload.current_price_source,
      resolved_current_price_rs_kg: price,
      resolved_current_price_at:
        payload.current_price_source === "system" ? "2024-12-23" : null,
      resolved_current_price_age_days:
        payload.current_price_source === "system" ? 608 : 0,
      resolved_current_price_quality:
        payload.current_price_source === "system" ? "latest_recorded" : "manual_input",
      model_input_price_rs_kg: price,
      persistence_next_price_rs_kg: price,
      model_run_id: "run_001",
      model_role: "experimental_secondary",
      context_quality: "incomplete",
      weather_missing: true,
      inflation_missing: true,
      source_type: "exact_market",
      history_basis: "exact_market",
      is_market_specific: true,
      fallback_used: false,
      meta: {
        latest_market_price_rs_kg: payload.market === "meegoda" ? 448 : 424,
        latest_history_price_rs_kg: payload.market === "meegoda" ? 448 : 424,
        context_quality: "incomplete",
      },
    },
  };
};

test("manual request keeps price and returns canonical UNCERTAIN", async () => {
  const originalPost = axios.post;
  const originalWeather = weatherForecastService.getSevenDayRainfallContext;
  const originalGroq = groqInsightGenerator.generateGroqInsights;
  const payloads = [];
  let forecastLocation = null;
  let receivedWeatherContext = null;
  const weatherContext = {
    period: "next_7_days",
    forecast_location: "meegoda",
    total_rainfall_mm: 75,
    average_daily_rainfall_mm: 10.71,
    rainy_days: 6,
    max_rain_probability: 90,
    rainfall_risk: "HIGH",
    source: "open_meteo",
  };
  axios.post = async (_url, payload) => {
    payloads.push(payload);
    return fakeMlResponse(payload);
  };
  weatherForecastService.getSevenDayRainfallContext = async (location) => {
    forecastLocation = location;
    return weatherContext;
  };
  groqInsightGenerator.generateGroqInsights = async (data) => {
    receivedWeatherContext = data.weatherContext;
    return groqInsightGenerator.createFallbackInsights(data);
  };

  try {
    const res = makeResponse();
    await recommendBestMarket(
      {
        body: {
          crop: "beans",
          district: "meegoda",
          current_price_source: "manual",
          price_rs_kg: 400,
          horizon: 1,
        },
      },
      res
    );

    assert.equal(res.state.statusCode, 200);
    assert.equal(payloads.length, 2);
    assert.ok(payloads.every((payload) => payload.price_rs_kg === 400));
    assert.equal(res.state.body.action_decision, "UNCERTAIN");
    assert.equal(res.state.body.persistence_next_price_rs_kg, 400);
    assert.equal(res.state.body.recommended_market.predicted_price_rs_kg, 425.6);
    assert.ok(
      res.state.body.action_reason_codes.includes("MODEL_SIGNAL_CONFLICT")
    );
    assert.equal(res.state.body.recommended_market.market, "meegoda");
    assert.equal(forecastLocation, "meegoda");
    assert.deepEqual(receivedWeatherContext, weatherContext);
    const insightText = Object.values(res.state.body.ai_insights).join(" ");
    assert.doesNotMatch(insightText, /\b(wait|sell now)\b/i);
  } finally {
    axios.post = originalPost;
    weatherForecastService.getSevenDayRainfallContext = originalWeather;
    groqInsightGenerator.generateGroqInsights = originalGroq;
  }
});

test("system request never sends placeholder price and uses resolved price", async () => {
  const originalPost = axios.post;
  const originalWeather = weatherForecastService.getSevenDayRainfallContext;
  const payloads = [];
  axios.post = async (_url, payload) => {
    payloads.push(payload);
    return fakeMlResponse(payload);
  };
  weatherForecastService.getSevenDayRainfallContext = async () => null;

  try {
    const res = makeResponse();
    await recommendBestMarket(
      {
        body: {
          crop: "beans",
          district: "meegoda",
          current_price_source: "system",
          horizon: 1,
        },
      },
      res
    );

    assert.equal(res.state.statusCode, 200);
    assert.equal(payloads.length, 2);
    assert.ok(payloads.every((payload) => !("price_rs_kg" in payload)));
    assert.equal(
      res.state.body.recommended_market.model_input_price_rs_kg,
      448
    );
    assert.notEqual(
      res.state.body.recommended_market.model_input_price_rs_kg,
      1
    );
    assert.equal(res.state.body.action_decision, "UNCERTAIN");
    assert.equal(res.state.body.persistence_next_price_rs_kg, 448);
    assert.equal(res.state.body.recommended_market.market, "meegoda");
  } finally {
    axios.post = originalPost;
    weatherForecastService.getSevenDayRainfallContext = originalWeather;
  }
});

test("weather failure does not change a successful recommendation", async () => {
  const originalPost = axios.post;
  const originalWeather = weatherForecastService.getSevenDayRainfallContext;
  const originalGroq = groqInsightGenerator.generateGroqInsights;
  let receivedWeatherContext = "not-called";

  axios.post = async (_url, payload) => fakeMlResponse(payload);
  weatherForecastService.getSevenDayRainfallContext = async () => {
    throw new Error("weather unavailable");
  };
  groqInsightGenerator.generateGroqInsights = async (data) => {
    receivedWeatherContext = data.weatherContext;
    return groqInsightGenerator.createFallbackInsights(data);
  };

  try {
    const res = makeResponse();
    await recommendBestMarket(
      {
        body: {
          crop: "beans",
          district: "meegoda",
          current_price_source: "manual",
          price_rs_kg: 400,
          horizon: 1,
        },
      },
      res
    );

    assert.equal(res.state.statusCode, 200);
    assert.equal(receivedWeatherContext, null);
    assert.equal(res.state.body.persistence_next_price_rs_kg, 400);
    assert.equal(res.state.body.recommended_market.predicted_price_rs_kg, 425.6);
    assert.equal(res.state.body.recommended_market.market, "meegoda");
    assert.equal(res.state.body.action_decision, "UNCERTAIN");
    assert.equal(res.state.body.action_authorized, false);
  } finally {
    axios.post = originalPost;
    weatherForecastService.getSevenDayRainfallContext = originalWeather;
    groqInsightGenerator.generateGroqInsights = originalGroq;
  }
});

test("unsupported horizons are rejected before ML inference", async () => {
  const originalPost = axios.post;
  let called = false;
  axios.post = async () => {
    called = true;
    throw new Error("should not be called");
  };

  try {
    for (const horizon of [2, 3, 4]) {
      const res = makeResponse();
      await recommendBestMarket(
        {
          body: {
            crop: "beans",
            district: "meegoda",
            current_price_source: "manual",
            price_rs_kg: 400,
            horizon,
          },
        },
        res
      );
      assert.equal(res.state.statusCode, 400);
      assert.equal(res.state.body.code, "UNSUPPORTED_HORIZON");
    }
    assert.equal(called, false);
  } finally {
    axios.post = originalPost;
  }
});
