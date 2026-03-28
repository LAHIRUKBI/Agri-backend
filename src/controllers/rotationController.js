const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const SoilConfig = require('../models/SoilConfig');
const { calculateCurrentNutrients } = require('../../algorithms/nutrientCalculator');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Global dynamic import for node-fetch
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

exports.getRotationPlan = async (req, res) => {
  try {
    const { targetCrop, currentMonth, previousCrops, language } = req.body;
    const userId = req.user.id;

    if (!previousCrops || previousCrops.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one past crop.' });
    }
    
    let baseConfig = await SoilConfig.findOne() || { nutrients: [{symbol:'N', min:50}, {symbol:'P', min:20}, {symbol:'K', min:100}] };
    
    // 1. Calculate the current soil nutrient status based on history
    const calcResult = calculateCurrentNutrients(baseConfig, previousCrops);
    
    // 2. Send data to Python ML Backend for prediction
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

    // 3. Save the evaluated plan
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