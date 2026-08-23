const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const districtMarketMap = require("../../src/utils/districtMarketMap");

const {
  DISTRICT_COORDINATES,
  getSevenDayRainfallContext,
  OPEN_METEO_TIMEOUT_MS,
  RAINY_DAY_THRESHOLD_MM,
} = require("../../src/services/weatherForecastService");

const dates = [
  "2026-08-23",
  "2026-08-24",
  "2026-08-25",
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
];

const responseFor = (precipitation, probabilities = [10, 20, 30, 40, 50, 40, 30]) => ({
  data: {
    daily: {
      time: dates,
      precipitation_sum: precipitation,
      ...(probabilities == null
        ? {}
        : { precipitation_probability_max: probabilities }),
    },
  },
});

const withAxiosGet = async (implementation, assertion) => {
  const originalGet = axios.get;
  axios.get = implementation;
  try {
    await assertion();
  } finally {
    axios.get = originalGet;
  }
};

test("coordinate map covers every supported request district", () => {
  const aliases = { nuwaraeliya: "nuwara eliya" };
  const missing = Object.keys(districtMarketMap).filter(
    (district) => !DISTRICT_COORDINATES[aliases[district] || district]
  );

  assert.deepEqual(missing, []);
});

test("valid response calculates total, average, rainy days, and request parameters", async () => {
  let request = null;
  await withAxiosGet(async (url, options) => {
    request = { url, options };
    return responseFor([0, 0.5, 1, 2, 3, 4, 5]);
  }, async () => {
    const context = await getSevenDayRainfallContext("  Nuwara   Eliya ");

    assert.deepEqual(context, {
      period: "next_7_days",
      forecast_location: "nuwara eliya",
      total_rainfall_mm: 15.5,
      average_daily_rainfall_mm: 2.21,
      rainy_days: 5,
      max_rain_probability: 50,
      rainfall_risk: "MODERATE",
      source: "open_meteo",
    });
    assert.equal(RAINY_DAY_THRESHOLD_MM, 1);
    assert.equal(request.url, "https://api.open-meteo.com/v1/forecast");
    assert.equal(request.options.timeout, OPEN_METEO_TIMEOUT_MS);
    assert.equal(request.options.timeout, 3000);
    assert.equal(request.options.params.forecast_days, 7);
    assert.equal(request.options.params.past_days, 0);
    assert.equal(request.options.params.timezone, "Asia/Colombo");
    assert.equal(
      request.options.params.daily,
      "precipitation_sum,precipitation_probability_max"
    );
  });
});

test("HIGH boundary is inclusive", async () => {
  await withAxiosGet(
    async () => responseFor([10, 10, 10, 10, 10, 10, 10]),
    async () => {
      const context = await getSevenDayRainfallContext("colombo");
      assert.equal(context.total_rainfall_mm, 70);
      assert.equal(context.rainfall_risk, "HIGH");
    }
  );
});

test("HIGH sustained-rain and probability branches are inclusive", async () => {
  const cases = [
    {
      precipitation: [8, 8, 8, 8, 8, 0, 0],
      probabilities: [20, 20, 20, 20, 20, 20, 20],
    },
    {
      precipitation: [1, 1, 1, 1, 0, 0, 0],
      probabilities: [80, 20, 20, 20, 20, 20, 20],
    },
  ];

  for (const scenario of cases) {
    await withAxiosGet(
      async () => responseFor(scenario.precipitation, scenario.probabilities),
      async () => {
        const context = await getSevenDayRainfallContext("badulla");
        assert.equal(context.rainfall_risk, "HIGH");
      }
    );
  }
});

test("MODERATE boundary is inclusive", async () => {
  await withAxiosGet(
    async () => responseFor([5, 5, 5, 5, 5, 0, 0], [20, 20, 20, 20, 20, 20, 20]),
    async () => {
      const context = await getSevenDayRainfallContext("gampaha");
      assert.equal(context.total_rainfall_mm, 25);
      assert.equal(context.rainfall_risk, "MODERATE");
    }
  );
});

test("MODERATE rainy-day and probability branches are inclusive", async () => {
  const cases = [
    {
      precipitation: [1, 1, 1, 0, 0, 0, 0],
      probabilities: [20, 20, 20, 20, 20, 20, 20],
    },
    {
      precipitation: [0, 0, 0, 0, 0, 0, 0],
      probabilities: [60, 20, 20, 20, 20, 20, 20],
    },
  ];

  for (const scenario of cases) {
    await withAxiosGet(
      async () => responseFor(scenario.precipitation, scenario.probabilities),
      async () => {
        const context = await getSevenDayRainfallContext("ratnapura");
        assert.equal(context.rainfall_risk, "MODERATE");
      }
    );
  }
});

test("LOW case avoids escalation", async () => {
  await withAxiosGet(
    async () => responseFor([0, 0.2, 0.4, 1, 0, 0, 0], [10, 20, 30, 40, 50, 20, 10]),
    async () => {
      const context = await getSevenDayRainfallContext("kalutara");
      assert.equal(context.rainy_days, 1);
      assert.equal(context.max_rain_probability, 50);
      assert.equal(context.rainfall_risk, "LOW");
    }
  );
});

test("missing probability remains usable and classifies from rainfall only", async () => {
  await withAxiosGet(
    async () => responseFor([5, 5, 5, 5, 5, 0, 0], null),
    async () => {
      const context = await getSevenDayRainfallContext("kandy");
      assert.equal(context.max_rain_probability, null);
      assert.equal(context.rainfall_risk, "MODERATE");
    }
  );
});

test("incomplete probability arrays use the maximum valid value", async () => {
  await withAxiosGet(
    async () => responseFor([0, 0, 0, 0, 0, 0, 0], [null, 40, 60]),
    async () => {
      const context = await getSevenDayRainfallContext("puttalam");
      assert.equal(context.max_rain_probability, 60);
      assert.equal(context.rainfall_risk, "MODERATE");
    }
  );
});

test("unsupported location returns null without making a request", async () => {
  let called = false;
  await withAxiosGet(async () => {
    called = true;
    throw new Error("should not be called");
  }, async () => {
    assert.equal(await getSevenDayRainfallContext("unsupported"), null);
    assert.equal(called, false);
  });
});

test("malformed time and rainfall arrays return null", async () => {
  const malformedResponses = [
    { data: { daily: { time: dates.slice(0, 6), precipitation_sum: [1, 1, 1, 1, 1, 1, 1] } } },
    { data: { daily: { time: dates, precipitation_sum: [1, 1, 1] } } },
    { data: { daily: { time: dates } } },
    { data: {} },
  ];

  for (const response of malformedResponses) {
    await withAxiosGet(async () => response, async () => {
      assert.equal(await getSevenDayRainfallContext("matale"), null);
    });
  }
});

test("negative and non-finite rainfall values return null", async () => {
  for (const invalidValue of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    await withAxiosGet(
      async () => responseFor([0, 1, 2, invalidValue, 4, 5, 6]),
      async () => {
        assert.equal(await getSevenDayRainfallContext("galle"), null);
      }
    );
  }
});

test("timeout or network failure returns null", async () => {
  for (const errorCode of ["ECONNABORTED", "ENETUNREACH"]) {
    await withAxiosGet(async () => {
      const error = new Error(errorCode);
      error.code = errorCode;
      throw error;
    }, async () => {
      assert.equal(await getSevenDayRainfallContext("matara"), null);
    });
  }
});
