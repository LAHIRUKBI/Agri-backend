const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const SoilConfig = require('../models/SoilConfig');
const { calculateGapAndSuitability } = require('../../algorithms/nutrientCalculator');
const { acresToSqFt } = require('../../algorithms/landCalculator');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

exports.getRotationPlan = async (req, res) => {
  try {
    // අලුතින් එක් කළ soilType, phLevel, rainfall මෙතැනින් ලබා ගනී
    const { targetCrop, targetLandSize, soilType, phLevel, rainfall, currentMonth, previousCrops, language } = req.body;
    const userId = req.user.id;

    if (!previousCrops || previousCrops.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one past crop.' });
    }

    let baseConfig = await SoilConfig.findOne();
    if (!baseConfig) {
        return res.status(500).json({ error: 'Soil configuration not found. Please set N-P-K limits in the Database.' });
    }
    
    const baselineNutrients = {
        N: baseConfig.nutrients.find(n => n.symbol === 'N').min,
        P: baseConfig.nutrients.find(n => n.symbol === 'P').min,
        K: baseConfig.nutrients.find(n => n.symbol === 'K').min
    };

    // Python API එකට අලුත් Environmental Factors යැවීම
    const pythonPredictRes = await fetch('http://localhost:8000/predict_npk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        targetCrop, targetLandSize, currentMonth, previousCrops, language, baselineNutrients,
        soilType, phLevel, rainfall 
      }),
    });
    const predictedSoil = await pythonPredictRes.json();

    const pythonReqRes = await fetch(`http://localhost:8000/get_requirements/${targetCrop}`);
    const targetRequirements = await pythonReqRes.json();

    const gapAnalysis = calculateGapAndSuitability(predictedSoil, targetRequirements, baseConfig);

    const landCalculations = previousCrops.map(crop => ({
        cropName: crop.cropName,
        acres: crop.landSize,
        sqFt: acresToSqFt(crop.landSize)
    }));

    let aiSoilRemedy = "Soil is well-suited for this crop! Maintain current nutrient levels.";
    let alternativeSuggestions = [];

    if (!gapAnalysis.isSuitable) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const remedyPrompt = `The farmer wants to plant '${targetCrop}' on ${targetLandSize} Acres. Current soil differences: Nitrogen: ${gapAnalysis.differences.diffN.toFixed(2)} ppm, Phosphorus: ${gapAnalysis.differences.diffP.toFixed(2)} ppm, Potassium: ${gapAnalysis.differences.diffK.toFixed(2)} ppm. Provide a clear agricultural recommendation to fix this in ${language}.`;
        const remedyResponse = await model.generateContent(remedyPrompt);
        aiSoilRemedy = remedyResponse.response.text();

        const altPrompt = `Soil nutrients: N: ${predictedSoil.current_n.toFixed(2)}ppm, P: ${predictedSoil.current_p.toFixed(2)}ppm, K: ${predictedSoil.current_k.toFixed(2)}ppm. Crop '${targetCrop}' is NOT suitable. Recommend EXACTLY TWO alternative crops that thrive in these conditions. Provide exactly 4 reasons for each. Language: ${language}. Output ONLY a valid JSON array like: [{"cropName": "Name", "reasons": ["R1", "R2", "R3", "R4"]}]`;
        const altResponse = await model.generateContent(altPrompt);
        
        const cleanText = altResponse.response.text().replace(/\`\`\`json/g, '').replace(/\n\`\`\`/g, '').trim();
        alternativeSuggestions = JSON.parse(cleanText);

      } catch (aiError) {
        console.error("Gemini API Error bypassed:", aiError.message);
        aiSoilRemedy = `⚠️ AI Assistant is currently experiencing high demand. However, based on our ML system calculations, your soil lacks the exact required nutrients for '${targetCrop}'. Please check the Nutrient Status Table below and apply fertilizers accordingly.`;
        alternativeSuggestions = []; 
      }
    }

    const finalData = {
      targetEvaluation: {
        isSuitable: gapAnalysis.isSuitable,
        isFertile: gapAnalysis.isFertile, 
        feedback: [`Nutrient evaluation complete for '${targetCrop}'.`],
        aiSoilRemedy: aiSoilRemedy
      },
      soilNutrientLevels: [
        { 
          nutrient: "Nitrogen (N)", 
          level: `${predictedSoil.current_n.toFixed(2)} ppm`, 
          depletionPrediction: gapAnalysis.statuses.N, 
          difference: parseFloat(gapAnalysis.differences.diffN.toFixed(2)),
          targetMin: gapAnalysis.requirements.N.min,
          targetMax: gapAnalysis.requirements.N.max
        },
        { 
          nutrient: "Phosphorus (P)", 
          level: `${predictedSoil.current_p.toFixed(2)} ppm`, 
          depletionPrediction: gapAnalysis.statuses.P, 
          difference: parseFloat(gapAnalysis.differences.diffP.toFixed(2)),
          targetMin: gapAnalysis.requirements.P.min,
          targetMax: gapAnalysis.requirements.P.max
        },
        { 
          nutrient: "Potassium (K)", 
          level: `${predictedSoil.current_k.toFixed(2)} ppm`, 
          depletionPrediction: gapAnalysis.statuses.K, 
          difference: parseFloat(gapAnalysis.differences.diffK.toFixed(2)),
          targetMin: gapAnalysis.requirements.K.min,
          targetMax: gapAnalysis.requirements.K.max
        }
      ],
      alternativeSuggestions,
      chemicalBreakdown: predictedSoil.chemical_breakdown || [],
      calculatorDetails: {
          requirements: gapAnalysis.requirements,
          statuses: gapAnalysis.statuses,
          differences: gapAnalysis.differences,
          landCalculations: landCalculations
      }
    };

    // Database එකට අලුත් variables ටිකත් Save කිරීම
    const newPlan = new RotationPlan({
      user: userId, targetCrop, targetLandSize, currentMonth,
      soilType, phLevel, rainfall, // <--- New DB Fields
      pastCrops: previousCrops, targetEvaluation: finalData.targetEvaluation,
      soilNutrientLevels: finalData.soilNutrientLevels, alternativeSuggestions,
      chemicalBreakdown: finalData.chemicalBreakdown,
      calculatorDetails: finalData.calculatorDetails
    });
    await newPlan.save();

    res.status(200).json(finalData);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to generate rotation plan.' });
  }
};

exports.getSavedPlans = async (req, res) => {
  try {
    const userId = req.user.id;
    const plans = await RotationPlan.find({ user: userId }).sort({ createdAt: -1 });
    res.status(200).json(plans);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch saved rotation plans.' });
  }
};

exports.deletePlan = async (req, res) => {
  try {
    const planId = req.params.id;
    const userId = req.user.id;
    const deletedPlan = await RotationPlan.findOneAndDelete({ _id: planId, user: userId });
    
    if (!deletedPlan) {
      return res.status(404).json({ error: 'Plan not found or unauthorized.' });
    }
    res.status(200).json({ message: 'Plan deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete the rotation plan.' });
  }
};