const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const SoilConfig = require('../models/SoilConfig');
const { calculateCurrentNutrients } = require('../../algorithms/nutrientCalculator');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// The Machine Learning Pipeline
exports.getRotationPlan = async (req, res) => {
  try {
    const { targetCrop, currentMonth, previousCrops, language } = req.body;
    const userId = req.user.id;

    if (!previousCrops || previousCrops.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one past crop.' });
    }
    
    let baseConfig = await SoilConfig.findOne() || { nutrients: [{symbol:'N', min:50}, {symbol:'P', min:20}, {symbol:'K', min:100}] };
    
    const calcResult = calculateCurrentNutrients(baseConfig, previousCrops);
    
    // Dynamic import for node-fetch if using Node < 18
    const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
    
    const pythonResponse = await fetch('http://localhost:8000/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetCrop,
        currentMonth,
        previousCrops,
        language: language || "Sinhala",
        calculatedNutrients: calcResult.current,
        historyImpact: calcResult.historyImpact,
        baselineNutrients: calcResult.baseline
      }),
    });

    const parsedData = await pythonResponse.json();

    if (parsedData.error) {
       throw new Error(parsedData.error);
    }

    const newPlan = new RotationPlan({
      user: userId,
      targetCrop,
      currentMonth,
      pastCrops: previousCrops,
      targetEvaluation: parsedData.targetEvaluation,
      soilNutrientLevels: parsedData.soilNutrientLevels,
    });
    
    await newPlan.save();
    res.status(200).json(parsedData);

  } catch (error) {
    res.status(500).json({ error: error.message || 'Failed to generate ML rotation plan.' });
  }
};



// Fetch all saved plans for the logged-in user
exports.getSavedPlans = async (req, res) => {
  try {
    const userId = req.user.id;
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