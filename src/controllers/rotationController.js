// backend/src/controllers/rotationController.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const SoilConfig = require('../models/SoilConfig');
const { calculateGapAndSuitability } = require('../../algorithms/nutrientCalculator');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

function getNpkValuesFromSoilConfig(config) {
  const nutrients = Array.isArray(config?.nutrients) ? config.nutrients : [];
  const getMin = (symbol, fallback) => {
    const item = nutrients.find((n) => String(n.symbol || '').trim().toUpperCase() === symbol);
    const value = Number(item?.min);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  return { N: getMin('N', 50), P: getMin('P', 20), K: getMin('K', 100) };
}

async function readJsonResponse(response, label) {
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; }
  catch { throw new Error(`${label} returned invalid JSON (HTTP ${response.status}).`); }
  if (!response.ok) {
    throw new Error(data.detail || data.error || data.message || `${label} failed (HTTP ${response.status}).`);
  }
  return data;
}

exports.getRotationPlan = async (req, res) => {
  try {
    const { targetCrop, targetLandSize, currentMonth, previousCrops, language } = req.body;
    const userId = req.user.id;

    if (!targetCrop || !Number.isFinite(Number(targetLandSize)) || Number(targetLandSize) <= 0) {
      return res.status(400).json({ error: 'Please provide a target crop and a valid land size in acres.' });
    }
    if (!Array.isArray(previousCrops) || previousCrops.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one past crop.' });
    }

    // 1. Read the existing admin-entered N/P/K values.
    const baseConfig = await SoilConfig.findOne();
    if (!baseConfig) {
      return res.status(400).json({ error: 'Soil nutrient configuration is missing. Please save it in Soil Nutrients Management.' });
    }
    const baselineNutrients = getNpkValuesFromSoilConfig(baseConfig);
    console.log("[Rotation Plan] Baseline NPK:", baselineNutrients);

    
const pythonPredictRes = await fetch(
  'http://localhost:8000/predict_npk',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetCrop,
      targetLandSize,
      currentMonth,
      previousCrops,
      language,
      baselineNutrients
    }),
  }
);

const responseText = await pythonPredictRes.text();

let predictedSoil;

try {
  predictedSoil = JSON.parse(responseText);
} catch (parseError) {
  console.error(
    '[NPK] Python returned invalid JSON.',
    'HTTP status:', pythonPredictRes.status,
    'Response:', responseText
  );

  throw new Error(
    `N-P-K prediction service returned invalid JSON ` +
    `(HTTP ${pythonPredictRes.status}).`
  );
}

if (!pythonPredictRes.ok) {
  console.error(
    '[NPK] Python prediction failed:',
    pythonPredictRes.status,
    predictedSoil
  );

  throw new Error(
    predictedSoil.detail ||
    predictedSoil.error ||
    `Python prediction failed (HTTP ${pythonPredictRes.status}).`
  );
}


    // 3. Get target-crop N/P/K requirements.
    const encodedCrop = encodeURIComponent(targetCrop);
    const pythonReqRes = await fetch(`http://localhost:8000/get_requirements/${encodedCrop}`);
    const targetRequirements = await readJsonResponse(pythonReqRes, 'Crop nutrient requirements service');

    // 4. Compare the current configured N/P/K values to crop requirements.
    const gapAnalysis = calculateGapAndSuitability(predictedSoil, targetRequirements);

    let aiSoilRemedy = 'Soil nutrient evaluation is complete. Follow the target crop requirements and local agricultural guidance.';
    let alternativeSuggestions = [];
    if (!gapAnalysis.isSuitable && process.env.GEMINI_API_KEY) {
      const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
      const remedyPrompt = `The farmer wants to plant '${targetCrop}' on ${targetLandSize} acres. Current N-P-K values are N ${Number(predictedSoil.current_n).toFixed(2)} ppm, P ${Number(predictedSoil.current_p).toFixed(2)} ppm, K ${Number(predictedSoil.current_k).toFixed(2)} ppm. Nutrient differences from crop requirements: N ${Number(gapAnalysis.differences.diffN).toFixed(2)} ppm, P ${Number(gapAnalysis.differences.diffP).toFixed(2)} ppm, K ${Number(gapAnalysis.differences.diffK).toFixed(2)} ppm. Give practical, cautious agricultural guidance in ${language || 'English'}. Do not claim laboratory certainty.`;
      try {
        const remedyResponse = await model.generateContent(remedyPrompt);
        aiSoilRemedy = remedyResponse.response.text();
      } catch (err) {
        console.error('Gemini remedy generation failed:', err.message);
      }
      const altPrompt = `Current configured soil nutrient values: N ${Number(predictedSoil.current_n).toFixed(2)} ppm, P ${Number(predictedSoil.current_p).toFixed(2)} ppm, K ${Number(predictedSoil.current_k).toFixed(2)} ppm. The target crop '${targetCrop}' did not pass the current requirement comparison. Suggest exactly two possible alternative crops, each with exactly four concise reasons. Reply only as valid JSON array: [{"cropName":"Name","reasons":["R1","R2","R3","R4"]}]. Language: ${language || 'English'}. Treat suggestions as provisional, not verified agronomic advice.`;
      try {
        const altResponse = await model.generateContent(altPrompt);
        const cleanText = altResponse.response.text().replace(/```json/gi, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleanText);
        if (Array.isArray(parsed)) {
          alternativeSuggestions = parsed.slice(0, 2).map((item) => ({
            cropName: String(item.cropName || 'Unknown crop'),
            reasons: Array.isArray(item.reasons) ? item.reasons.slice(0, 4).map(String) : [],
          }));
        }
      } catch (err) {
        console.error('Gemini alternative generation failed:', err.message);
        alternativeSuggestions = [];
      }
    }

    const soilNutrientLevels = [
      { nutrient: 'Nitrogen (N)', level: `${Number(predictedSoil.current_n).toFixed(2)} ppm`, depletionPrediction: gapAnalysis.statuses.N, difference: Number(gapAnalysis.differences.diffN.toFixed(2)), targetMin: gapAnalysis.requirements.N.min, targetMax: gapAnalysis.requirements.N.max },
      { nutrient: 'Phosphorus (P)', level: `${Number(predictedSoil.current_p).toFixed(2)} ppm`, depletionPrediction: gapAnalysis.statuses.P, difference: Number(gapAnalysis.differences.diffP.toFixed(2)), targetMin: gapAnalysis.requirements.P.min, targetMax: gapAnalysis.requirements.P.max },
      { nutrient: 'Potassium (K)', level: `${Number(predictedSoil.current_k).toFixed(2)} ppm`, depletionPrediction: gapAnalysis.statuses.K, difference: Number(gapAnalysis.differences.diffK.toFixed(2)), targetMin: gapAnalysis.requirements.K.min, targetMax: gapAnalysis.requirements.K.max },
    ];

    const chemicalBreakdown = (Array.isArray(predictedSoil.chemical_breakdown) ? predictedSoil.chemical_breakdown : []).map((item) => ({
      ...item,
      added: item.added || item.added_g_per_sqft || { N: 0, P: 0, K: 0 },
    }));

    const finalData = {
      targetEvaluation: {
        isSuitable: gapAnalysis.isSuitable,
        feedback: [`Nutrient evaluation complete for '${targetCrop}'.`],
        aiSoilRemedy,
      },
      soilNutrientLevels,
      alternativeSuggestions,
      chemicalBreakdown,
      // This is historical fertilizer nutrient mass, not soil ppm.
      fertilizerContribution: predictedSoil.fertilizer_contribution || null,
      warnings: Array.isArray(predictedSoil.warnings) ? predictedSoil.warnings : [],
      calculatorDetails: {
        requirements: gapAnalysis.requirements,
        statuses: gapAnalysis.statuses,
        differences: gapAnalysis.differences,
      },
    };

    const newPlan = new RotationPlan({
      user: userId, targetCrop, targetLandSize, currentMonth,
      pastCrops: previousCrops,
      targetEvaluation: finalData.targetEvaluation,
      soilNutrientLevels: finalData.soilNutrientLevels,
      alternativeSuggestions,
      chemicalBreakdown: finalData.chemicalBreakdown,
      calculatorDetails: finalData.calculatorDetails,
    });
    await newPlan.save();
    return res.status(200).json(finalData);
  } catch (error) {
    console.error('[Rotation Plan] Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to generate rotation plan.' });
  }
};

exports.getSavedPlans = async (req, res) => {
  try {
    const plans = await RotationPlan.find({ user: req.user.id }).sort({ createdAt: -1 });
    return res.status(200).json(plans);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch saved rotation plans.' });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    const deletedPlan = await RotationPlan.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    if (!deletedPlan) return res.status(404).json({ error: 'Plan not found or unauthorized.' });
    return res.status(200).json({ message: 'Plan deleted successfully.' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete the rotation plan.' });
  }
};
