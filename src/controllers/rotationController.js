const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const SoilConfig = require('../models/SoilConfig');
const { calculateCurrentNutrients } = require('../../algorithms/nutrientCalculator');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)); // Ensure node-fetch is installed, or use axios

// The Machine Learning Pipeline
exports.getRotationPlan = async (req, res) => {
  try {
    const { targetCrop, currentMonth, previousCrops, language } = req.body;
    const userId = req.user.id;

    if (!previousCrops || previousCrops.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one past crop.' });
    }
    if (!targetCrop) {
      return res.status(400).json({ error: 'Please specify the crop you want to plant.' });
    }
    // 1. Get Base Soil Config from DB
    let baseConfig = await SoilConfig.findOne();
    if (!baseConfig) {
       baseConfig = { nutrients: [{symbol:'N', min:50}, {symbol:'P', min:20}, {symbol:'K', min:100}] };
    }
    // 2. Execute Algorithm
    const calcResult = calculateCurrentNutrients(baseConfig, previousCrops);
    // 3. Send to Python Server
    const pythonResponse = await fetch('http://localhost:8000/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetCrop,
        currentMonth,
        previousCrops,
        language,
        calculatedNutrients: calcResult.current,
        historyImpact: calcResult.historyImpact,
        baselineNutrients: calcResult.baseline
      }),
    });

    if (!pythonResponse.ok) {
      const errorText = await pythonResponse.text();
      console.error("❌ Python API Error Details:", errorText);
      throw new Error(`Machine Learning model rejected request: ${errorText}`);
    }

    const parsedData = await pythonResponse.json();

    if (parsedData.error) {
       throw new Error(parsedData.error);
    }
    // 4. Save Plan
    const newPlan = new RotationPlan({
      user: userId,
      targetCrop,
      currentMonth,
      pastCrops: previousCrops,
      soilCondition: parsedData.soilCondition,
      targetEvaluation: parsedData.targetEvaluation,
      alternativeSuggestions: parsedData.alternativeSuggestions,
      soilNutrientLevels: parsedData.soilNutrientLevels,
      requiredNutrients: parsedData.requiredNutrients
    });
    await newPlan.save();

    res.status(200).json(parsedData);

  } catch (error) {
    console.error("Rotation Plan Error:", error);
    res.status(500).json({ error: error.message || 'Failed to generate ML rotation plan.' });
  }
};



// Fetch all saved plans for the logged-in user
exports.getSavedPlans = async (req, res) => {
  try {
    const userId = req.user.id;
    // Fetch plans and sort by newest first
    const plans = await RotationPlan.find({ user: userId }).sort({ createdAt: -1 });
    res.status(200).json(plans);
  } catch (error) {
    console.error('Fetch Plans Error:', error);
    res.status(500).json({ error: 'Failed to fetch saved rotation plans.' });
  }
};



// Delete a specific plan
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
    console.error('Delete Plan Error:', error);
    res.status(500).json({ error: 'Failed to delete the rotation plan.' });
  }
};