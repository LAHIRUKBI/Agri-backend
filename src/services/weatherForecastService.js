const axios = require("axios");

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const OPEN_METEO_TIMEOUT_MS = 3000;
const FORECAST_DAYS = 7;
const RAINY_DAY_THRESHOLD_MM = 1.0;
const DAILY_FORECAST_VARIABLES = Object.freeze([
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_probability_max",
  "precipitation_sum",
]);

const RAINFALL_RISK_THRESHOLDS = Object.freeze({
  highTotalRainfallMm: 70,
  highSustainedRainyDays: 5,
  highSustainedTotalRainfallMm: 40,
  highProbabilityPercent: 80,
  highProbabilityRainyDays: 4,
  moderateTotalRainfallMm: 25,
  moderateRainyDays: 3,
  moderateProbabilityPercent: 60,
});

// Reviewed coordinates for every request district currently supported by
// districtMarketMap. These identify the farmer/request district, not a
// destination market.
const DISTRICT_COORDINATES = Object.freeze({
  colombo: Object.freeze({ latitude: 6.9271, longitude: 79.8612 }),
  gampaha: Object.freeze({ latitude: 7.0873, longitude: 80.0144 }),
  kalutara: Object.freeze({ latitude: 6.5854, longitude: 79.9607 }),
  kandy: Object.freeze({ latitude: 7.2906, longitude: 80.6337 }),
  matale: Object.freeze({ latitude: 7.4675, longitude: 80.6234 }),
  "nuwara eliya": Object.freeze({ latitude: 6.9497, longitude: 80.7891 }),
  galle: Object.freeze({ latitude: 6.0329, longitude: 80.2168 }),
  matara: Object.freeze({ latitude: 5.9549, longitude: 80.555 }),
  kurunegala: Object.freeze({ latitude: 7.4863, longitude: 80.3647 }),
  puttalam: Object.freeze({ latitude: 8.0408, longitude: 79.8394 }),
  badulla: Object.freeze({ latitude: 6.9934, longitude: 81.055 }),
  kegalle: Object.freeze({ latitude: 7.2513, longitude: 80.3464 }),
  ratnapura: Object.freeze({ latitude: 6.6828, longitude: 80.3992 }),
  dambulla: Object.freeze({ latitude: 7.8742, longitude: 80.6511 }),
  meegoda: Object.freeze({ latitude: 6.844, longitude: 80.047 }),
});

const DISTRICT_ALIASES = Object.freeze({
  nuwaraeliya: "nuwara eliya",
});

const normalizeLocationName = (locationName) => {
  const normalized = String(locationName || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return DISTRICT_ALIASES[normalized] || normalized;
};

const roundSummaryNumber = (value) => Number(value.toFixed(2));

const formatLocationName = (locationName) =>
  locationName.replace(/\b\w/g, (character) => character.toUpperCase());

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const buildDailyForecast = (daily) => {
  const times = daily?.time;
  const weatherCodes = daily?.weather_code;
  const maximumTemperatures = daily?.temperature_2m_max;
  const minimumTemperatures = daily?.temperature_2m_min;
  const rainProbabilities = daily?.precipitation_probability_max;
  const rainfallTotals = daily?.precipitation_sum;

  if (!Array.isArray(times)) {
    return [];
  }

  const days = [];
  const availableDayCount = Math.min(times.length, FORECAST_DAYS);

  for (let index = 0; index < availableDayCount; index += 1) {
    const date = times[index];
    const weatherCode = weatherCodes?.[index];
    const maximumTemperature = maximumTemperatures?.[index];
    const minimumTemperature = minimumTemperatures?.[index];
    const rainProbability = rainProbabilities?.[index];
    const rainfall = rainfallTotals?.[index];

    const hasCompleteRealDay =
      typeof date === "string" &&
      date.length > 0 &&
      isFiniteNumber(weatherCode) &&
      isFiniteNumber(maximumTemperature) &&
      isFiniteNumber(minimumTemperature) &&
      isFiniteNumber(rainProbability) &&
      rainProbability >= 0 &&
      rainProbability <= 100 &&
      isFiniteNumber(rainfall) &&
      rainfall >= 0;

    if (!hasCompleteRealDay) {
      continue;
    }

    days.push({
      date,
      weather_code: weatherCode,
      temperature_max_c: maximumTemperature,
      temperature_min_c: minimumTemperature,
      rain_probability: rainProbability,
      rainfall_mm: rainfall,
    });
  }

  return days;
};

const classifyRainfallRisk = ({
  totalRainfallMm,
  rainyDays,
  maxRainProbability,
}) => {
  const thresholds = RAINFALL_RISK_THRESHOLDS;
  const hasProbability = Number.isFinite(maxRainProbability);

  // These deterministic thresholds are operational advisory rules only. They
  // are not scientifically validated price-impact thresholds and must never
  // be used to modify a price prediction or canonical selling decision.
  if (
    totalRainfallMm >= thresholds.highTotalRainfallMm ||
    (rainyDays >= thresholds.highSustainedRainyDays &&
      totalRainfallMm >= thresholds.highSustainedTotalRainfallMm) ||
    (hasProbability &&
      maxRainProbability >= thresholds.highProbabilityPercent &&
      rainyDays >= thresholds.highProbabilityRainyDays)
  ) {
    return "HIGH";
  }

  if (
    totalRainfallMm >= thresholds.moderateTotalRainfallMm ||
    rainyDays >= thresholds.moderateRainyDays ||
    (hasProbability &&
      maxRainProbability >= thresholds.moderateProbabilityPercent)
  ) {
    return "MODERATE";
  }

  return "LOW";
};

const getMaximumValidProbability = (probabilities) => {
  if (!Array.isArray(probabilities)) {
    return null;
  }

  const finiteProbabilities = probabilities.filter(
    (value) =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 100
  );

  return finiteProbabilities.length > 0
    ? Math.max(...finiteProbabilities)
    : null;
};

const buildRainfallContext = (locationName, responseData) => {
  const daily = responseData?.daily;
  const times = daily?.time;
  const precipitation = daily?.precipitation_sum;

  if (
    !Array.isArray(times) ||
    times.length !== FORECAST_DAYS ||
    !times.every((value) => typeof value === "string" && value.length > 0) ||
    !Array.isArray(precipitation) ||
    precipitation.length !== FORECAST_DAYS ||
    !precipitation.every(
      (value) =>
        typeof value === "number" && Number.isFinite(value) && value >= 0
    )
  ) {
    return null;
  }

  const totalRainfallMm = precipitation.reduce((sum, value) => sum + value, 0);
  const rainyDays = precipitation.filter(
    (value) => value >= RAINY_DAY_THRESHOLD_MM
  ).length;
  const maxRainProbability = getMaximumValidProbability(
    daily?.precipitation_probability_max
  );
  const rainfallRisk = classifyRainfallRisk({
    totalRainfallMm,
    rainyDays,
    maxRainProbability,
  });

  return {
    // The forecast period is today plus the following six local calendar days.
    period: "next_7_days",
    forecast_location: locationName,
    total_rainfall_mm: roundSummaryNumber(totalRainfallMm),
    average_daily_rainfall_mm: roundSummaryNumber(
      totalRainfallMm / FORECAST_DAYS
    ),
    rainy_days: rainyDays,
    max_rain_probability:
      maxRainProbability == null ? null : roundSummaryNumber(maxRainProbability),
    rainfall_risk: rainfallRisk,
    source: "open_meteo",
    weather_forecast: {
      location: formatLocationName(locationName),
      period: "next_7_days",
      source: "open_meteo",
      days: buildDailyForecast(daily),
    },
  };
};

const getSevenDayRainfallContext = async (locationName) => {
  const normalizedLocation = normalizeLocationName(locationName);
  const coordinates = DISTRICT_COORDINATES[normalizedLocation];

  if (!coordinates) {
    return null;
  }

  try {
    const response = await axios.get(OPEN_METEO_FORECAST_URL, {
      params: {
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        daily: DAILY_FORECAST_VARIABLES.join(","),
        forecast_days: FORECAST_DAYS,
        past_days: 0,
        timezone: "Asia/Colombo",
        precipitation_unit: "mm",
      },
      timeout: OPEN_METEO_TIMEOUT_MS,
    });

    return buildRainfallContext(normalizedLocation, response?.data);
  } catch (error) {
    return null;
  }
};

module.exports = {
  getSevenDayRainfallContext,
  DISTRICT_COORDINATES,
  FORECAST_DAYS,
  OPEN_METEO_TIMEOUT_MS,
  RAINFALL_RISK_THRESHOLDS,
  RAINY_DAY_THRESHOLD_MM,
};
