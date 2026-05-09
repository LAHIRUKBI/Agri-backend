const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const SoilConfig = require('../models/SoilConfig');
const { calculateGapAndSuitability } = require('../../algorithms/nutrientCalculator');
const { acresToSqFt } = require('../../algorithms/landCalculator');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

exports.getRotationPlan = async (req, res) => {
  try {
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

    const pythonPredictRes = await fetch('http://localhost:8000/predict_npk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        targetCrop, targetLandSize, currentMonth, previousCrops, language
      }),
    });
    const predictedSoil = await pythonPredictRes.json();

    const pythonReqRes = await fetch(`http://localhost:8000/get_requirements/${targetCrop}`);
    const targetRequirements = await pythonReqRes.json();

    // Environmental factors දැන් යවන්නේ JS Calculator එකටයි
    const gapAnalysis = calculateGapAndSuitability(predictedSoil, targetRequirements, baseConfig, phLevel, rainfall, previousCrops);

    // Land Area Calculation කොටස
    const landCalculations = previousCrops.map(crop => ({
        cropName: crop.cropName,
        acres: crop.landSize,
        sqFt: acresToSqFt(crop.landSize)
    }));

    // AI Soil Remedy කොටස
    let aiSoilRemedy = "Soil is well-suited for this crop! Maintain current nutrient levels.";
    let alternativeSuggestions = []; // මුලින් මෙය හිස්ව යවමු

    if (!gapAnalysis.isSuitable) {
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const remedyPrompt = `The farmer wants to plant '${targetCrop}' on ${targetLandSize} Acres. Current soil differences: Nitrogen: ${gapAnalysis.differences.diffN.toFixed(2)} ppm, Phosphorus: ${gapAnalysis.differences.diffP.toFixed(2)} ppm, Potassium: ${gapAnalysis.differences.diffK.toFixed(2)} ppm. Provide a clear agricultural recommendation to fix this in ${language}.`;
        const remedyResponse = await model.generateContent(remedyPrompt);
        aiSoilRemedy = remedyResponse.response.text();
      } catch (aiError) {
        console.error("Gemini API Error bypassed:", aiError.message);
        aiSoilRemedy = `⚠️ AI Assistant is currently experiencing high demand. Please check the Nutrient Status Table below and apply fertilizers accordingly.`;
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
          nutrient: "Nitrogen (N)", level: gapAnalysis.currentLevels.N.toFixed(2), 
          depletionPrediction: gapAnalysis.statuses.N, difference: gapAnalysis.differences.diffN,
          targetMin: gapAnalysis.requirements.N.min, targetMax: gapAnalysis.requirements.N.max,
          breakdown: gapAnalysis.breakdown.N // Breakdown data is mapped here
        },
        { 
          nutrient: "Phosphorus (P)", level: gapAnalysis.currentLevels.P.toFixed(2), 
          depletionPrediction: gapAnalysis.statuses.P, difference: gapAnalysis.differences.diffP,
          targetMin: gapAnalysis.requirements.P.min, targetMax: gapAnalysis.requirements.P.max,
          breakdown: gapAnalysis.breakdown.P // Breakdown data is mapped here
        },
        { 
          nutrient: "Potassium (K)", level: gapAnalysis.currentLevels.K.toFixed(2), 
          depletionPrediction: gapAnalysis.statuses.K, difference: gapAnalysis.differences.diffK,
          targetMin: gapAnalysis.requirements.K.min, targetMax: gapAnalysis.requirements.K.max,
          breakdown: gapAnalysis.breakdown.K // Breakdown data is mapped here
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

    const newPlan = new RotationPlan({
      user: userId, targetCrop, targetLandSize, currentMonth,
      soilType, phLevel, rainfall,
      pastCrops: previousCrops, targetEvaluation: finalData.targetEvaluation,
      soilNutrientLevels: finalData.soilNutrientLevels, alternativeSuggestions,
      chemicalBreakdown: finalData.chemicalBreakdown,
      calculatorDetails: finalData.calculatorDetails
    });
    const savedPlan = await newPlan.save();
    
    // සේව් වූ Plan එකේ ID එක Frontend එකට යවමු (පසුව Alternatives Update කිරීමට)
    finalData.planId = savedPlan._id;

    res.status(200).json(finalData);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || 'Failed to generate rotation plan.' });
  }
};

// Button එක click කරාම පමණක් AI වලින් Alternative crops 2ක් ගෙන එයි
exports.getAlternativeCrops = async (req, res) => {
  try {
    const { planId, targetCrop, currentN, currentP, currentK, language } = req.body;
    const userId = req.user.id;

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const altPrompt = `Soil nutrients: N: ${currentN}ppm, P: ${currentP}ppm, K: ${currentK}ppm. Crop '${targetCrop}' is NOT suitable. Recommend EXACTLY TWO alternative crops that thrive in these conditions. Provide exactly 4 reasons for each. Language: ${language}. Output ONLY a valid JSON array like: [{"cropName": "Name", "reasons": ["R1", "R2", "R3", "R4"]}]`;
    
    const altResponse = await model.generateContent(altPrompt);
    const cleanText = altResponse.response.text().replace(/\`\`\`json/g, '').replace(/\n\`\`\`/g, '').trim();
    const alternativeSuggestions = JSON.parse(cleanText);

    if (planId) {
       await RotationPlan.findOneAndUpdate(
         { _id: planId, user: userId },
         { alternativeSuggestions: alternativeSuggestions }
       );
    }

    res.status(200).json({ alternativeSuggestions });
  } catch (error) {
    console.error("AI Alternative Error:", error);
    res.status(500).json({ error: 'Failed to generate alternative crops via AI.' });
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