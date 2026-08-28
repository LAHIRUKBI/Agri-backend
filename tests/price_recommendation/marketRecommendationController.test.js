const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const groqInsightGenerator = require("../../src/utils/groqInsightGenerator");
const weatherForecastService = require("../../src/services/weatherForecastService");
const districtMarketMap = require("../../src/utils/districtMarketMap");

process.env.GROQ_API_KEY = "";
const {
  getMarketOptions,
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
        requested_district: payload.district,
        requested_market: payload.market,
        district_rows_available: 10,
        latest_market_price_rs_kg: payload.market === "meegoda" ? 448 : 424,
        latest_history_price_rs_kg: payload.market === "meegoda" ? 448 : 424,
        context_quality: "incomplete",
      },
    },
  };
};

test("authoritative map contains only supported administrative districts", () => {
  assert.deepEqual(districtMarketMap, {
    colombo: ["meegoda", "kandy"],
    gampaha: ["meegoda", "kandy"],
    kalutara: ["meegoda", "kandy"],
    kandy: ["kandy", "dambulla"],
    matale: ["dambulla", "kandy"],
    "nuwara eliya": ["nuwaraeliya", "kandy"],
    galle: ["meegoda", "kandy"],
    matara: ["meegoda", "kandy"],
    kurunegala: ["kandy", "dambulla"],
    puttalam: ["puttalam", "kandy"],
    badulla: ["nuwaraeliya", "bandarawela"],
    kegalle: ["kandy", "meegoda"],
    ratnapura: ["meegoda", "kandy"],
  });
});

test("options expose authoritative mapped markets without side effects", async () => {
  const originalPost = axios.post;
  const originalWeather = weatherForecastService.getSevenDayRainfallContext;
  const originalGroq = groqInsightGenerator.generateGroqInsights;
  let sideEffectCalls = 0;

  axios.post = async () => {
    sideEffectCalls += 1;
    throw new Error("ML must not be called");
  };
  weatherForecastService.getSevenDayRainfallContext = async () => {
    sideEffectCalls += 1;
    throw new Error("weather must not be called");
  };
  groqInsightGenerator.generateGroqInsights = async () => {
    sideEffectCalls += 1;
    throw new Error("Groq must not be called");
  };

  const cases = [
    ["colombo", ["meegoda", "kandy"]],
    ["matale", ["dambulla", "kandy"]],
    ["badulla", ["nuwaraeliya", "bandarawela"]],
  ];

  try {
    for (const [farmerDistrict, expectedMarkets] of cases) {
      const res = makeResponse();
      getMarketOptions(
        { query: { farmer_district: farmerDistrict } },
        res
      );

      assert.equal(res.state.statusCode, 200);
      assert.deepEqual(res.state.body, {
        success: true,
        farmer_district: farmerDistrict,
        available_markets: expectedMarkets.map((market) => ({
          value: market,
          label: market.charAt(0).toUpperCase() + market.slice(1),
        })),
      });
    }
    assert.equal(sideEffectCalls, 0);
  } finally {
    axios.post = originalPost;
    weatherForecastService.getSevenDayRainfallContext = originalWeather;
    groqInsightGenerator.generateGroqInsights = originalGroq;
  }
});

test("legacy administrative district alias still works", async () => {
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
          district: " Colombo ",
          current_price_source: "manual",
          price_rs_kg: 400,
          horizon: 1,
        },
      },
      res
    );

    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.farmer_district, "colombo");
    assert.deepEqual(res.state.body.available_markets, ["meegoda", "kandy"]);
    assert.equal(payloads.length, 2);
  } finally {
    axios.post = originalPost;
    weatherForecastService.getSevenDayRainfallContext = originalWeather;
  }
});

test("conflicting district fields are rejected before inference", async () => {
  const originalPost = axios.post;
  let mlCalls = 0;
  axios.post = async () => {
    mlCalls += 1;
    throw new Error("should not be called");
  };

  try {
    const res = makeResponse();
    await recommendBestMarket(
      {
        body: {
          crop: "beans",
          farmer_district: "colombo",
          district: "kandy",
          current_price_source: "manual",
          price_rs_kg: 400,
          horizon: 1,
        },
      },
      res
    );

    assert.equal(res.state.statusCode, 400);
    assert.equal(res.state.body.code, "FARMER_DISTRICT_CONFLICT");
    assert.equal(mlCalls, 0);
  } finally {
    axios.post = originalPost;
  }
});

test("invalid and market-location districts are rejected for new and legacy fields", async () => {
  const originalPost = axios.post;
  let mlCalls = 0;
  axios.post = async () => {
    mlCalls += 1;
    throw new Error("should not be called");
  };

  try {
    const invalidRequests = [
      { farmer_district: "unsupported" },
      { farmer_district: "meegoda" },
      { farmer_district: "dambulla" },
      { district: "meegoda" },
      { district: "dambulla" },
    ];

    for (const districtFields of invalidRequests) {
      const res = makeResponse();
      await recommendBestMarket(
        {
          body: {
            crop: "beans",
            ...districtFields,
            current_price_source: "manual",
            price_rs_kg: 400,
            horizon: 1,
          },
        },
        res
      );

      assert.equal(res.state.statusCode, 400);
      assert.equal(res.state.body.code, "INVALID_FARMER_DISTRICT");
    }
    assert.equal(mlCalls, 0);
  } finally {
    axios.post = originalPost;
  }
});

test("farmer district request keeps price, run_001 adapter, weather, and canonical policy", async () => {
  const originalPost = axios.post;
  const originalWeather = weatherForecastService.getSevenDayRainfallContext;
  const originalGroq = groqInsightGenerator.generateGroqInsights;
  const payloads = [];
  let forecastLocation = null;
  let receivedWeatherContext = null;
  const weatherContext = {
    period: "next_7_days",
    forecast_location: "colombo",
    total_rainfall_mm: 75,
    average_daily_rainfall_mm: 10.71,
    rainy_days: 6,
    max_rain_probability: 90,
    rainfall_risk: "HIGH",
    source: "open_meteo",
  };
  const weatherForecast = {
    location: "Colombo",
    period: "next_7_days",
    source: "open_meteo",
    days: [
      {
        date: "2026-08-25",
        weather_code: 61,
        temperature_max_c: 28.4,
        temperature_min_c: 23.1,
        rain_probability: 85,
        rainfall_mm: 12.6,
      },
    ],
  };
  axios.post = async (_url, payload) => {
    payloads.push(payload);
    return fakeMlResponse(payload);
  };
  weatherForecastService.getSevenDayRainfallContext = async (location) => {
    forecastLocation = location;
    return { ...weatherContext, weather_forecast: weatherForecast };
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
          farmer_district: "colombo",
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
    assert.ok(payloads.every((payload) => payload.district === payload.market));
    assert.deepEqual(
      payloads.map(({ district, market }) => ({ district, market })),
      [
        { district: "meegoda", market: "meegoda" },
        { district: "kandy", market: "kandy" },
      ]
    );
    assert.equal(res.state.body.farmer_district, "colombo");
    assert.deepEqual(res.state.body.available_markets, ["meegoda", "kandy"]);
    assert.equal(res.state.body.action_decision, "WAIT");
    assert.equal(res.state.body.persistence_next_price_rs_kg, 400);
    assert.equal(res.state.body.recommended_market.model_estimate_experimental, true);
    assert.equal(res.state.body.recommended_market.predicted_price_rs_kg, 425.6);
    assert.deepEqual(res.state.body.market_outlook, {
      status: "MIXED",
      strength: "LOW",
      signal_alignment: "CONFLICT",
      price_signal: "UP",
      direction_signal: "DOWN",
      confidence: 0.56,
      summary:
        "The experimental price estimate and direction classifier point in different directions.",
    });
    assert.deepEqual(
      res.state.body.recommended_market.market_outlook,
      res.state.body.market_outlook
    );
    assert.ok(
      res.state.body.comparisons.every(
        (comparison) => comparison.market_outlook != null
      )
    );
    assert.doesNotMatch(
      JSON.stringify(res.state.body.market_outlook),
      /\bWAIT\b|\bHOLD\b|\bSELL_NOW\b|\bSELL NOW\b|BEST TIME TO SELL/i
    );
    assert.deepEqual(res.state.body.action_reason_codes, [
      "PREDICTED_PRICE_INCREASE_AT_LEAST_RS5",
    ]);
    assert.equal(res.state.body.action_decision, "WAIT");
    assert.equal(res.state.body.action_policy, "rs5_price_direction_v1");
    assert.equal(res.state.body.action_authorized, true);
    assert.equal(res.state.body.recommended_market.market, "meegoda");
    assert.equal(res.state.body.primary_mapped_market.market, "meegoda");
    assert.equal("nearest_market" in res.state.body, false);
    assert.ok(
      res.state.body.comparisons.every(
        (comparison) => !("inference_district" in comparison)
      )
    );
    assert.ok(
      res.state.body.comparisons.every(
        (comparison) => comparison.farmer_district === "colombo"
      )
    );
    assert.ok(
      res.state.body.comparisons.every(
        (comparison) => comparison.requested_district === "colombo"
      )
    );
    assert.ok(
      res.state.body.comparisons.every(
        (comparison) => !("requested_district" in comparison.meta)
      )
    );
    assert.ok(
      res.state.body.comparisons.every(
        (comparison) => !("district_rows_available" in comparison.meta)
      )
    );
    assert.equal(forecastLocation, "colombo");
    assert.deepEqual(receivedWeatherContext, weatherContext);
    assert.deepEqual(res.state.body.weather_forecast, weatherForecast);
    assert.notEqual(
      res.state.body.weather_forecast.location.toLowerCase(),
      res.state.body.recommended_market.market
    );
    const insightText = Object.values(res.state.body.ai_insights).join(" ");
    assert.match(insightText, /\bwait\b/i);
    assert.doesNotMatch(insightText, /\bsell now\b/i);
    assert.doesNotMatch(
      insightText,
      /\b(?:nearest|closest|nearby|lower transport|transport savings)\b/i
    );
  } finally {
    axios.post = originalPost;
    weatherForecastService.getSevenDayRainfallContext = originalWeather;
    groqInsightGenerator.generateGroqInsights = originalGroq;
  }
});

test("controller propagates UNCERTAIN for a sub-Rs.5 predicted movement", async () => {
  const originalPost = axios.post;
  const originalWeather = weatherForecastService.getSevenDayRainfallContext;
  const originalGroq = groqInsightGenerator.generateGroqInsights;

  axios.post = async (_url, payload) => {
    const response = fakeMlResponse(payload);
    response.data.predicted_price_rs_kg = payload.price_rs_kg + 4;
    return response;
  };
  weatherForecastService.getSevenDayRainfallContext = async () => null;
  groqInsightGenerator.generateGroqInsights = async (data) =>
    groqInsightGenerator.createFallbackInsights(data);

  try {
    const res = makeResponse();
    await recommendBestMarket(
      {
        body: {
          crop: "beans",
          farmer_district: "colombo",
          current_price_source: "manual",
          price_rs_kg: 400,
          horizon: 1,
        },
      },
      res
    );

    assert.equal(res.state.statusCode, 200);
    assert.equal(res.state.body.action_decision, "UNCERTAIN");
    assert.equal(res.state.body.action_authorized, false);
    assert.equal(res.state.body.action_policy, "rs5_price_direction_v1");
    assert.deepEqual(res.state.body.action_reason_codes, [
      "PRICE_DIFFERENCE_BELOW_RS5_THRESHOLD",
    ]);
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
          farmer_district: "colombo",
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
    assert.equal(res.state.body.action_decision, "SELL_NOW");
    assert.equal(res.state.body.action_authorized, true);
    assert.deepEqual(res.state.body.action_reason_codes, [
      "PREDICTED_PRICE_DECREASE_AT_LEAST_RS5",
    ]);
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
          farmer_district: "colombo",
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
    assert.equal(res.state.body.action_decision, "WAIT");
    assert.equal(res.state.body.action_authorized, true);
    assert.equal(res.state.body.weather_forecast, null);
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
            farmer_district: "colombo",
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
