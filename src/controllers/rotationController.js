const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const RotationRule = require('../models/RotationRule');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args)); // Ensure node-fetch is installed, or use axios

// The NEW Machine Learning Pipeline
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

    // Send data to the Python ML Server
    const pythonResponse = await fetch('http://localhost:8000/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetCrop,
        currentMonth,
        previousCrops,
        language
      }),
    });

    // ---> NEW: Exact Error Tracking <---
    if (!pythonResponse.ok) {
      const errorText = await pythonResponse.text();
      console.error("❌ Python API Error Details:", errorText);
      throw new Error(`Machine Learning model rejected request: ${errorText}`);
    }

    const parsedData = await pythonResponse.json();

    // Check if Python returned an internal logical error
    if (parsedData.error) {
       throw new Error(parsedData.error);
    }

    // Save the ML evaluation to MongoDB for history
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

    // Ensure the plan belongs to the logged-in user before deleting
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



exports.fetchNewRules = async (req, res) => {
  try {
    const prompt = `
      Search your agricultural knowledge base for 5 proven crop rotation rules suitable for tropical climates like Sri Lanka.
      Respond strictly with a JSON array where each object has:
      1. "ruleName": Name of the rotation pattern.
      2. "description": A simple explanation of why it works.
      3. "sequence": An array of crop types (e.g. ["Legumes", "Leafy Greens", "Root crops"]).
      4. "source": The name of a reliable agricultural institution, university, or official internet source this is derived from.
      Only output the raw JSON array. Do not include markdown formatting outside the JSON.
    `;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    
    // Parse the response
    const rawText = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    const rules = JSON.parse(rawText);

    const savedRules = [];
    for (let rule of rules) {
      const newRule = await RotationRule.create({
        ruleName: rule.ruleName,
        description: rule.description,
        sequence: rule.sequence,
        source: rule.source,
        status: 'pending' // Keeps it in the review queue
      });
      savedRules.push(newRule);
    }

    res.status(200).json({ success: true, data: savedRules, message: "Successfully fetched new rules." });
  } catch (error) {
    console.error("Error fetching new rules from AI:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.getPendingRules = async (req, res) => {
  try {
    const rules = await RotationRule.find({ status: 'pending' }).sort({ fetchedAt: -1 });
    res.status(200).json({ success: true, data: rules });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

exports.updateRuleStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'approved' or 'ignored'
    const rule = await RotationRule.findByIdAndUpdate(id, { status }, { new: true });
    res.status(200).json({ success: true, data: rule });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};