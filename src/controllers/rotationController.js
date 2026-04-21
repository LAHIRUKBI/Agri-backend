const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const SoilConfig = require('../models/SoilConfig');
const { calculateGapAndSuitability } = require('../../algorithms/nutrientCalculator');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Global dynamic import for node-fetch
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

exports.getRotationPlan = async (req, res) => {
  try {
    const { targetCrop, targetLandSize, currentMonth, previousCrops, language } = req.body;
    const userId = req.user.id;

    if (!previousCrops || previousCrops.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one past crop.' });
    }

    // 1. Baseline N-P-K ලබා ගැනීම
    let baseConfig = await SoilConfig.findOne() || { nutrients: [{symbol:'N', min:50}, {symbol:'P', min:20}, {symbol:'K', min:100}] };
    const baselineNutrients = {
        N: baseConfig.nutrients.find(n => n.symbol === 'N')?.min || 50,
        P: baseConfig.nutrients.find(n => n.symbol === 'P')?.min || 20,
        K: baseConfig.nutrients.find(n => n.symbol === 'K')?.min || 100
    };

    // 2. Python ML Model එකෙන් වත්මන් N-P-K ලබා ගැනීම (පියවර 1)
    const pythonPredictRes = await fetch('http://localhost:8000/predict_npk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetCrop, targetLandSize, currentMonth, previousCrops, language, baselineNutrients }),
    });
    const predictedSoil = await pythonPredictRes.json();

    // 3. Python එකෙන් Target Crop හි Standard N-P-K ලබා ගැනීම 
    const pythonReqRes = await fetch(`http://localhost:8000/get_requirements/${targetCrop}`);
    const targetRequirements = await pythonReqRes.json();

    // 4. nutrientCalculator හරහා Gap Analysis සිදු කිරීම (පියවර 2)
    const gapAnalysis = calculateGapAndSuitability(predictedSoil, targetRequirements);

    // 5. AI හරහා Remedies සහ Alternatives ලබා ගැනීම (පියවර 3)
    let aiSoilRemedy = "Soil is well-suited for this crop! Maintain current nutrient levels.";
    let alternativeSuggestions = [];

    if (!gapAnalysis.isSuitable) {
      // මෙහිදී AI එක try-catch එකක් තුලට දමා ඇත. AI error එකක් ආවත් ML predictions UI එකට යයි.
      try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        // AI Remedy Prompt
        const remedyPrompt = `The farmer wants to plant '${targetCrop}' on ${targetLandSize} Acres. Current soil differences: Nitrogen: ${gapAnalysis.differences.diffN.toFixed(2)} ppm, Phosphorus: ${gapAnalysis.differences.diffP.toFixed(2)} ppm, Potassium: ${gapAnalysis.differences.diffK.toFixed(2)} ppm. Provide a clear agricultural recommendation to fix this in ${language}.`;
        const remedyResponse = await model.generateContent(remedyPrompt);
        aiSoilRemedy = remedyResponse.response.text();

        // AI Alternatives Prompt
        const altPrompt = `Soil nutrients: N: ${predictedSoil.current_n.toFixed(2)}ppm, P: ${predictedSoil.current_p.toFixed(2)}ppm, K: ${predictedSoil.current_k.toFixed(2)}ppm. Crop '${targetCrop}' is NOT suitable. Recommend EXACTLY TWO alternative crops that thrive in these conditions. Provide exactly 4 reasons for each. Language: ${language}. Output ONLY a valid JSON array like: [{"cropName": "Name", "reasons": ["R1", "R2", "R3", "R4"]}]`;
        const altResponse = await model.generateContent(altPrompt);
        const cleanText = altResponse.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        alternativeSuggestions = JSON.parse(cleanText);

      } catch (aiError) {
        console.error("Gemini API Error bypassed:", aiError.message);
        // AI කාර්යබහුල වූ විට පෙන්වන Default පණිවිඩය
        aiSoilRemedy = `⚠️ AI Assistant is currently experiencing high demand. However, based on our ML system calculations, your soil lacks the exact required nutrients for '${targetCrop}'. Please check the Nutrient Status Table below and apply fertilizers accordingly.`;
        alternativeSuggestions = []; // හිස් Array එකක් යවන බැවින් UI එකේ alternatives කොටස පෙන්වන්නේ නැත.
      }
    }

    // 6. Frontend එකට යැවීමට Data Format කිරීම
    const finalData = {
      targetEvaluation: {
        isSuitable: gapAnalysis.isSuitable,
        feedback: [`Nutrient evaluation complete for '${targetCrop}'.`],
        aiSoilRemedy: aiSoilRemedy
      },
      soilNutrientLevels: [
        { nutrient: "Nitrogen (N)", level: `${predictedSoil.current_n.toFixed(2)} ppm`, depletionPrediction: gapAnalysis.statuses.N, difference: parseFloat(gapAnalysis.differences.diffN.toFixed(2)) },
        { nutrient: "Phosphorus (P)", level: `${predictedSoil.current_p.toFixed(2)} ppm`, depletionPrediction: gapAnalysis.statuses.P, difference: parseFloat(gapAnalysis.differences.diffP.toFixed(2)) },
        { nutrient: "Potassium (K)", level: `${predictedSoil.current_k.toFixed(2)} ppm`, depletionPrediction: gapAnalysis.statuses.K, difference: parseFloat(gapAnalysis.differences.diffK.toFixed(2)) }
      ],
      alternativeSuggestions,
      chemicalBreakdown: predictedSoil.chemical_breakdown || [],
      calculatorDetails: {
          requirements: gapAnalysis.requirements,
          statuses: gapAnalysis.statuses,
          differences: gapAnalysis.differences
      }
    };

    // Save to Database
    const newPlan = new RotationPlan({
      user: userId, targetCrop, targetLandSize, currentMonth,
      pastCrops: previousCrops, targetEvaluation: finalData.targetEvaluation,
      soilNutrientLevels: finalData.soilNutrientLevels, alternativeSuggestions
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