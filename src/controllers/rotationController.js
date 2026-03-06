const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');
const RotationRule = require('../models/RotationRule');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

    const farmerHistory = previousCrops.map(crop => 
      `- Crop: ${crop.cropName}, Grown during: ${crop.timePeriod}, Fertilizers used: ${crop.fertilizers}, Pesticides used: ${crop.pesticides}`
    ).join('\n');

    const prompt = `
      You are an expert agronomist AI for a Smart Agriculture Support System.
      A farmer located in Homagama, Western Province, Sri Lanka wants to plant '${targetCrop}' in the current month of ${currentMonth}.
      
      They have previously grown the following crops in this plot:
      ${farmerHistory}

      Analyze the situation based on principles of crop rotation, nutrient balancing, pest cycle breaking, and local seasonality. 
      Consider the residual effects of all multiple fertilizers and pesticides mentioned.

      IMPORTANT INSTRUCTIONS: 
      1. Output MUST be in ${language}.
      2. If the target crop is NOT suitable, you MUST provide at least 3 alternative crops.
      3. Generate a soil condition table and a required nutrients table based on the history provided.
      
      Return ONLY a valid JSON object in this exact format, with no markdown formatting or extra text. Keep JSON keys exactly as English below, but translate all values to ${language}:
      {
        "soilCondition": {
          "status": "Short summary of expected soil health",
          "details": ["Specific observation 1", "Specific observation 2"]
        },
        "targetEvaluation": {
          "isSuitable": true or false,
          "feedback": ["Reason 1 why suitable or not", "Reason 2"]
        },
        "alternativeSuggestions": [
          {
            "cropName": "Name of highly recommended alternative crop",
            "reasons": ["Reason 1", "Reason 2"]
          }
        ],
        "soilNutrientLevels": [
          {
            "nutrient": "e.g., Nitrogen, Phosphorus",
            "level": "e.g., Low, Medium, High",
            "depletionPrediction": "Prediction on how fast it will deplete"
          }
        ],
        "requiredNutrients": [
          {
            "nutrient": "e.g., Nitrogen",
            "recommendedSource": "e.g., Urea, Compost, Legumes",
            "amount": "e.g., High Amount, Moderate"
          }
        ]
      }
    `;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const aiResponseText = result.response.text();

    const cleanedJson = aiResponseText.replace(/```json\n|\n```|```/g, '').trim();
    const parsedData = JSON.parse(cleanedJson);

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
    console.error('AI Error:', error);
    res.status(500).json({ error: 'Failed to generate AI rotation plan. Please try again.' });
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