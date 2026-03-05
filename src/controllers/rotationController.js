const { GoogleGenerativeAI } = require('@google/generative-ai');
const RotationPlan = require('../models/RotationPlan');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

exports.getRotationPlan = async (req, res) => {
  try {
    // language preference from the request
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

    // 1. Construct the Advanced AI Prompt with Language Support
    const prompt = `
      You are an expert agronomist AI for a Smart Agriculture Support System.
      A farmer located in Homagama, Western Province, Sri Lanka wants to plant '${targetCrop}' in the current month of ${currentMonth}.
      
      They have previously grown the following crops in this plot:
      ${farmerHistory}

      Analyze the situation based on principles of crop rotation, nutrient balancing (Nitrogen, Phosphorus, Potassium), pest cycle breaking, and local seasonality. Consider the residual effects of the fertilizers and pesticides mentioned.

      IMPORTANT INSTRUCTION: The user has requested the output to be in ${language}. You MUST provide all your evaluations, feedback, status summaries, and crop names in ${language}.
      
      Return ONLY a valid JSON object in this exact format, with no markdown formatting or extra text. Ensure the JSON keys EXACTLY match the English keys below, but translate the string VALUES into ${language}:
      {
        "soilCondition": {
          "status": "A short summary of the expected soil health (translated to ${language})",
          "details": ["Specific observation 1 based on past crops", "Specific observation 2"]
        },
        "targetEvaluation": {
          "isSuitable": true or false,
          "feedback": ["Reason 1 why it is suitable or not suitable", "Reason 2"]
        },
        "alternativeSuggestions": [
          {
            "cropName": "Name of a highly recommended alternative crop (translated to ${language})",
            "reasons": ["Reason 1", "Reason 2"]
          }
        ]
      }
    `;

    // 2. Call the AI Model
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const result = await model.generateContent(prompt);
    const aiResponseText = result.response.text();

    // Clean and parse the response
    const cleanedJson = aiResponseText.replace(/```json\n|\n```|```/g, '').trim();
    const parsedData = JSON.parse(cleanedJson);

    // 3. Store the interaction in MongoDB
    const newPlan = new RotationPlan({
      user: userId,
      targetCrop,
      currentMonth,
      pastCrops: previousCrops,
      soilCondition: parsedData.soilCondition,
      targetEvaluation: parsedData.targetEvaluation,
      alternativeSuggestions: parsedData.alternativeSuggestions
    });
    await newPlan.save();

    // 4. Send the result back to the frontend
    res.status(200).json(parsedData);

  } catch (error) {
    console.error('AI Error:', error);
    res.status(500).json({ error: 'Failed to generate AI rotation plan. Please try again.' });
  }
};