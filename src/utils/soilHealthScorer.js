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

const LANGUAGE_BUNDLES = {
  English: {
    classifications: {
      Excellent: 'Excellent',
      Good: 'Good',
      Fair: 'Fair',
      Poor: 'Poor'
    },
    levels: {
      Low: 'Low',
      High: 'High',
      Balanced: 'Balanced'
    },
    zones: {
      'Dry Zone': 'Dry Zone',
      'Intermediate Zone': 'Intermediate Zone',
      'Wet Zone': 'Wet Zone',
      'Urban / Mixed Zone': 'Urban / Mixed Zone',
      'Northern Dry Zone': 'Northern Dry Zone',
      'Mixed Zone': 'Mixed Zone'
    },
    soilTypes: {
      'Reddish Brown Earth': 'Reddish Brown Earth',
      'Low Humic Gley': 'Low Humic Gley',
      'Red Yellow Podzolic': 'Red Yellow Podzolic',
      'Alluvial / Sandy Mix': 'Alluvial / Sandy Mix',
      'Mixed Agricultural Soil': 'Mixed Agricultural Soil'
    },
    recommendations: {
      phLow: 'Soil appears acidic. Consider liming before the next planting cycle.',
      phHigh: 'Soil appears alkaline. Use organic matter and split fertilizer applications carefully.',
      nitrogenLow: 'Nitrogen is low. Apply a nitrogen-rich fertilizer or composted manure in split doses.',
      phosphorusLow: 'Phosphorus is low. Add a phosphorus-supporting basal fertilizer during land preparation.',
      potassiumLow: 'Potassium is low. Use a potassium source before flowering or fruit development.',
      moistureLow: 'Soil moisture is low. Improve irrigation scheduling or use mulch to retain water.',
      moistureHigh: 'Soil moisture is high. Improve drainage and avoid overwatering the field.',
      organicMatterLow: 'Organic matter appears low. Add compost or crop residue to improve soil structure.',
      excellent: 'Soil condition is strong overall. Maintain current practices and monitor before major fertilizer changes.',
      cropHint(cropType) {
        return `Use ${cropType} crop requirements as the final adjustment step before fertilizer application.`;
      }
    }
  },
  Sinhala: {
    classifications: {
      Excellent: 'විශිෂ්ටයි',
      Good: 'හොඳයි',
      Fair: 'මධ්‍යස්ථයි',
      Poor: 'අවමයි'
    },
    levels: {
      Low: 'අඩුයි',
      High: 'වැඩියි',
      Balanced: 'සමතුලිතයි'
    },
    zones: {
      'Dry Zone': 'වියළි කලාපය',
      'Intermediate Zone': 'අතරමැදි කලාපය',
      'Wet Zone': 'තෙත් කලාපය',
      'Urban / Mixed Zone': 'නාගරික / මිශ්‍ර කලාපය',
      'Northern Dry Zone': 'උතුරු වියළි කලාපය',
      'Mixed Zone': 'මිශ්‍ර කලාපය'
    },
    soilTypes: {
      'Reddish Brown Earth': 'රතු-දුඹුරු පස',
      'Low Humic Gley': 'අඩු හියුමස් ග්ලේ පස',
      'Red Yellow Podzolic': 'රතු-කහ පොඩ්සොලික් පස',
      'Alluvial / Sandy Mix': 'ගංගා තැන්පතු / වැලි මිශ්‍ර පස',
      'Mixed Agricultural Soil': 'මිශ්‍ර කෘෂිකාර්මික පස'
    },
    recommendations: {
      phLow: 'පස අම්ලීය බව පේනවා. ඊළඟ වගා වාරයට කලින් ලයිම් යෙදීම සලකා බලන්න.',
      phHigh: 'පස ක්ෂාරීය බව පේනවා. සජීව ද්‍රව්‍ය යොදා පොහොර අවස්ථා කිහිපයකට බෙදා යෙදීම සුදුසුයි.',
      nitrogenLow: 'නයිට්‍රජන් අඩුයි. නයිට්‍රජන් බහුල පොහොරක් හෝ කුණුපොහොර කොටස් වශයෙන් යොදන්න.',
      phosphorusLow: 'පොස්පරස් අඩුයි. ඉඩම සකස් කරන අවස්ථාවේ පොස්පරස් අඩංගු මුල් පොහොරක් යොදන්න.',
      potassiumLow: 'පොටෑසියම් අඩුයි. මල් හට ගැනීමට හෝ ගෙඩි පිහිටීමට පෙර පොටෑසියම් මූලාශ්‍රයක් යොදන්න.',
      moistureLow: 'පසේ තෙතමනය අඩුයි. ජලසැපයුම් කාලසටහන හොඳ කරන්න හෝ මල්ච් භාවිතා කරන්න.',
      moistureHigh: 'පසේ තෙතමනය වැඩියි. ජලාපවහනය හොඳ කරන්න සහ අධික ජලය යෙදීම වලක්වන්න.',
      organicMatterLow: 'සජීව ද්‍රව්‍ය අඩු බව පේනවා. කොම්පෝස්ට් හෝ වගා අවශේෂ එක්කර පස ව්‍යුහය හොඳ කරන්න.',
      excellent: 'සමස්ත පස තත්ත්වය හොඳයි. දැන් කරන ක්‍රම රැකගෙන, විශාල පොහොර වෙනස්කම් වලට කලින් පස නැවත නිරීක්ෂණය කරන්න.',
      cropHint(cropType) {
        return `${cropType} වගාව සඳහා අවසන් පොහොර තීරණය ගන්න කලින් එම වගාවේ අවශ්‍යතාත් සලකා බලන්න.`;
      }
    }
  }
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const round = (value, digits = 2) => Number(Number(value).toFixed(digits));

function getLanguageBundle(language = 'English') {
  return LANGUAGE_BUNDLES[language] || LANGUAGE_BUNDLES.English;
}

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

function buildRecommendations(readings, levels, scoreLabel, metadata = {}, bundle = LANGUAGE_BUNDLES.English) {
  const recommendations = [];

  if (levels.ph === 'Low') {
    recommendations.push(bundle.recommendations.phLow);
  }
  if (levels.ph === 'High') {
    recommendations.push(bundle.recommendations.phHigh);
  }
  if (levels.nitrogen === 'Low') {
    recommendations.push(bundle.recommendations.nitrogenLow);
  }
  if (levels.phosphorus === 'Low') {
    recommendations.push(bundle.recommendations.phosphorusLow);
  }
  if (levels.potassium === 'Low') {
    recommendations.push(bundle.recommendations.potassiumLow);
  }
  if (levels.moisture === 'Low') {
    recommendations.push(bundle.recommendations.moistureLow);
  }
  if (levels.moisture === 'High') {
    recommendations.push(bundle.recommendations.moistureHigh);
  }
  if (readings.organicMatter < IDEAL_RANGES.organicMatter.min) {
    recommendations.push(bundle.recommendations.organicMatterLow);
  }
  if (scoreLabel === 'Excellent') {
    recommendations.push(bundle.recommendations.excellent);
  }

  if (metadata.cropType) {
    recommendations.push(bundle.recommendations.cropHint(metadata.cropType));
  }

  return recommendations.slice(0, 6);
}

function computeSoilHealthAssessment(readings, metadata = {}, mode = 'image_only') {
  const bundle = getLanguageBundle(metadata.language);
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
  const classificationKey = classifyScore(finalScore);
  const levelsRaw = {
    ph: classifyLevel(readings.ph, IDEAL_RANGES.ph),
    nitrogen: classifyLevel(readings.nitrogen, IDEAL_RANGES.nitrogen),
    phosphorus: classifyLevel(readings.phosphorus, IDEAL_RANGES.phosphorus),
    potassium: classifyLevel(readings.potassium, IDEAL_RANGES.potassium),
    moisture: classifyLevel(readings.moisture, IDEAL_RANGES.moisture),
    organicMatter: classifyLevel(readings.organicMatter, IDEAL_RANGES.organicMatter)
  };

  const recommendations = buildRecommendations(readings, levelsRaw, classificationKey, metadata, bundle);
  const levels = Object.fromEntries(
    Object.entries(levelsRaw).map(([key, value]) => [key, bundle.levels[value] || value])
  );
  const soilTypeKey = readings.soilType || 'Mixed Agricultural Soil';
  const agroZoneKey = DISTRICT_ZONE_MAP[metadata.district] || 'Mixed Zone';

  return {
    mode,
    score: finalScore,
    classification: bundle.classifications[classificationKey] || classificationKey,
    classificationKey,
    confidence: readings.confidence || (mode === 'image_only' ? 0.78 : 0.92),
    soilType: bundle.soilTypes[soilTypeKey] || soilTypeKey,
    soilTypeKey,
    agroZone: bundle.zones[agroZoneKey] || agroZoneKey,
    agroZoneKey,
    readings: {
      ph: round(readings.ph),
      nitrogen: round(readings.nitrogen),
      phosphorus: round(readings.phosphorus),
      potassium: round(readings.potassium),
      moisture: round(readings.moisture),
      organicMatter: round(readings.organicMatter)
    },
    levels,
    levelsRaw,
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
