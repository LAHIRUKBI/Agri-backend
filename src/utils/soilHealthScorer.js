const IDEAL_RANGES = {
  ph: { min: 6.0, max: 7.2, weight: 0.2 },
  nitrogen: { min: 80, max: 180, weight: 0.2 },
  phosphorus: { min: 20, max: 50, weight: 0.15 },
  potassium: { min: 60, max: 140, weight: 0.15 },
  moisture: { min: 20, max: 40, weight: 0.15 },
  organicMatter: { min: 2.5, max: 6.0, weight: 0.15 }
};

const DISTRICT_ZONE_MAP = {
  Ampara: 'Dry Zone',
  Anuradhapura: 'Dry Zone',
  Batticaloa: 'Dry Zone',
  Hambantota: 'Dry Zone',
  Moneragala: 'Dry Zone',
  Polonnaruwa: 'Dry Zone',
  Puttalam: 'Dry Zone',
  Trincomalee: 'Dry Zone',
  Badulla: 'Intermediate Zone',
  Kegalle: 'Intermediate Zone',
  Kurunegala: 'Intermediate Zone',
  Matale: 'Intermediate Zone',
  Ratnapura: 'Intermediate Zone',
  Galle: 'Wet Zone',
  Gampaha: 'Wet Zone',
  Kalutara: 'Wet Zone',
  Kandy: 'Wet Zone',
  Matara: 'Wet Zone',
  'Nuwara Eliya': 'Wet Zone',
  Colombo: 'Urban / Mixed Zone',
  Jaffna: 'Northern Dry Zone',
  Kilinochchi: 'Northern Dry Zone',
  Mannar: 'Northern Dry Zone',
  Mullaitivu: 'Northern Dry Zone',
  Vavuniya: 'Northern Dry Zone'
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

function createMetricScore(value, config) {
  const { min, max } = config;

  if (value >= min && value <= max) {
    return 100;
  }

  const midpoint = (min + max) / 2;
  const tolerance = (max - min) / 2 || 1;
  const distance = Math.abs(value - midpoint);
  const penalty = clamp((distance / (tolerance * 2.5)) * 100, 0, 100);

  return round(clamp(100 - penalty, 0, 100));
}

function classifyScore(score) {
  if (score >= 86) return 'Excellent';
  if (score >= 66) return 'Good';
  if (score >= 41) return 'Fair';
  return 'Poor';
}

function classifyLevel(value, { min, max }) {
  if (value < min) return 'Low';
  if (value > max) return 'High';
  return 'Balanced';
}

function inferSoilTypeFromImage(imageMetrics = {}, district) {
  const redness = Number(imageMetrics.redMean || 0);
  const green = Number(imageMetrics.greenMean || 0);
  const blue = Number(imageMetrics.blueMean || 0);
  const texture = Number(imageMetrics.textureScore || 0);
  const brightness = Number(imageMetrics.brightness || 0);
  const zone = DISTRICT_ZONE_MAP[district] || 'Mixed Zone';

  if (redness > green + 18 && redness > blue + 25) {
    return 'Reddish Brown Earth';
  }
  if (brightness < 95 && texture > 55) {
    return 'Low Humic Gley';
  }
  if (zone === 'Wet Zone' && brightness < 120) {
    return 'Red Yellow Podzolic';
  }
  if (zone === 'Dry Zone' && brightness > 145) {
    return 'Alluvial / Sandy Mix';
  }
  return 'Mixed Agricultural Soil';
}

function estimateImageDrivenReadings(imageMetrics = {}, metadata = {}) {
  const brightness = Number(imageMetrics.brightness || 128);
  const texture = Number(imageMetrics.textureScore || 45);
  const red = Number(imageMetrics.redMean || 120);
  const green = Number(imageMetrics.greenMean || 105);
  const blue = Number(imageMetrics.blueMean || 90);

  const moisture = clamp(round(12 + ((140 - brightness) / 2.4) + texture * 0.25), 5, 70);
  const organicMatter = clamp(round(1.5 + ((120 - brightness) / 70) + texture / 55), 0.8, 7.5);
  const ph = clamp(round(5.4 + ((red - blue) / 120) + ((green - 100) / 250)), 4.5, 8.0);
  const nitrogen = clamp(round(55 + moisture * 1.2 + organicMatter * 12), 25, 220);
  const phosphorus = clamp(round(12 + organicMatter * 4.4 + (red - blue) / 18), 8, 70);
  const potassium = clamp(round(40 + moisture * 1.1 + (red + green - blue) / 8), 20, 180);

  return {
    ph,
    nitrogen,
    phosphorus,
    potassium,
    moisture,
    organicMatter,
    soilType: inferSoilTypeFromImage(imageMetrics, metadata.district),
    confidence: 0.78
  };
}

function buildRecommendations(readings, levels, scoreLabel, metadata = {}) {
  const recommendations = [];

  if (levels.ph === 'Low') {
    recommendations.push('Soil appears acidic. Consider liming before the next planting cycle.');
  }
  if (levels.ph === 'High') {
    recommendations.push('Soil appears alkaline. Use organic matter and split fertilizer applications carefully.');
  }
  if (levels.nitrogen === 'Low') {
    recommendations.push('Nitrogen is low. Apply a nitrogen-rich fertilizer or composted manure in split doses.');
  }
  if (levels.phosphorus === 'Low') {
    recommendations.push('Phosphorus is low. Add a phosphorus-supporting basal fertilizer during land preparation.');
  }
  if (levels.potassium === 'Low') {
    recommendations.push('Potassium is low. Use a potassium source before flowering or fruit development.');
  }
  if (levels.moisture === 'Low') {
    recommendations.push('Soil moisture is low. Improve irrigation scheduling or use mulch to retain water.');
  }
  if (levels.moisture === 'High') {
    recommendations.push('Soil moisture is high. Improve drainage and avoid overwatering the field.');
  }
  if (readings.organicMatter < IDEAL_RANGES.organicMatter.min) {
    recommendations.push('Organic matter appears low. Add compost or crop residue to improve soil structure.');
  }
  if (scoreLabel === 'Excellent') {
    recommendations.push('Soil condition is strong overall. Maintain current practices and monitor before major fertilizer changes.');
  }

  if (metadata.cropType) {
    recommendations.push(`Use ${metadata.cropType} crop requirements as the final adjustment step before fertilizer application.`);
  }

  return recommendations.slice(0, 6);
}

function computeSoilHealthAssessment(readings, metadata = {}, mode = 'image_only') {
  const scores = {
    ph: createMetricScore(readings.ph, IDEAL_RANGES.ph),
    nitrogen: createMetricScore(readings.nitrogen, IDEAL_RANGES.nitrogen),
    phosphorus: createMetricScore(readings.phosphorus, IDEAL_RANGES.phosphorus),
    potassium: createMetricScore(readings.potassium, IDEAL_RANGES.potassium),
    moisture: createMetricScore(readings.moisture, IDEAL_RANGES.moisture),
    organicMatter: createMetricScore(readings.organicMatter, IDEAL_RANGES.organicMatter)
  };

  const weightedScore =
    scores.ph * IDEAL_RANGES.ph.weight +
    scores.nitrogen * IDEAL_RANGES.nitrogen.weight +
    scores.phosphorus * IDEAL_RANGES.phosphorus.weight +
    scores.potassium * IDEAL_RANGES.potassium.weight +
    scores.moisture * IDEAL_RANGES.moisture.weight +
    scores.organicMatter * IDEAL_RANGES.organicMatter.weight;

  const finalScore = round(weightedScore, 0);
  const classification = classifyScore(finalScore);
  const levels = {
    ph: classifyLevel(readings.ph, IDEAL_RANGES.ph),
    nitrogen: classifyLevel(readings.nitrogen, IDEAL_RANGES.nitrogen),
    phosphorus: classifyLevel(readings.phosphorus, IDEAL_RANGES.phosphorus),
    potassium: classifyLevel(readings.potassium, IDEAL_RANGES.potassium),
    moisture: classifyLevel(readings.moisture, IDEAL_RANGES.moisture),
    organicMatter: classifyLevel(readings.organicMatter, IDEAL_RANGES.organicMatter)
  };

  const recommendations = buildRecommendations(readings, levels, classification, metadata);

  return {
    mode,
    score: finalScore,
    classification,
    confidence: readings.confidence || (mode === 'image_only' ? 0.78 : 0.92),
    soilType: readings.soilType || 'Mixed Agricultural Soil',
    agroZone: DISTRICT_ZONE_MAP[metadata.district] || 'Mixed Zone',
    readings: {
      ph: round(readings.ph),
      nitrogen: round(readings.nitrogen),
      phosphorus: round(readings.phosphorus),
      potassium: round(readings.potassium),
      moisture: round(readings.moisture),
      organicMatter: round(readings.organicMatter)
    },
    levels,
    parameterScores: scores,
    recommendations
  };
}

function createImageOnlyAssessment(imageMetrics = {}, metadata = {}) {
  const estimates = estimateImageDrivenReadings(imageMetrics, metadata);
  return computeSoilHealthAssessment(estimates, metadata, 'image_only');
}

function createFusionAssessment(sensorReadings = {}, imageMetrics = {}, metadata = {}) {
  const imageEstimates = estimateImageDrivenReadings(imageMetrics, metadata);
  const fusedReadings = {
    ph: sensorReadings.ph ?? imageEstimates.ph,
    nitrogen: sensorReadings.nitrogen ?? imageEstimates.nitrogen,
    phosphorus: sensorReadings.phosphorus ?? imageEstimates.phosphorus,
    potassium: sensorReadings.potassium ?? imageEstimates.potassium,
    moisture: sensorReadings.moisture ?? imageEstimates.moisture,
    organicMatter: sensorReadings.organicMatter ?? imageEstimates.organicMatter,
    soilType: imageEstimates.soilType,
    confidence: 0.92
  };

  return computeSoilHealthAssessment(fusedReadings, metadata, 'full_fusion');
}

module.exports = {
  createImageOnlyAssessment,
  createFusionAssessment,
  DISTRICT_ZONE_MAP
};
