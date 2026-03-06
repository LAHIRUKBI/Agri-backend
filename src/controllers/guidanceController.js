// backend/src/controllers/guidanceController.js
const { GoogleGenAI } = require('@google/genai');
const CropGuide = require('../models/CropGuide');

// Initialize Gemini SDK
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

exports.getRecommendations = async (req, res) => {
  try {
    const { district, date, month, language } = req.body;

    // 1. Check if we already have this data cached in MongoDB
    const existingGuide = await CropGuide.findOne({ district, month, language });
    if (existingGuide) {
      return res.status(200).json({ success: true, data: existingGuide.recommendations });
    }

    // 2. If not, construct the AI Prompt
    const prompt = `
      You are an expert agricultural AI for Sri Lanka. 
      The farmer is located in the ${district} district. Today is ${date}, in the month of ${month}. The preferred language for the output is ${language}.
      
      Provide a JSON array containing up to 20 highly suitable crops for this location and time. 
      For each crop, provide:
      1. "cropName": The name of the crop.
      2. "reasoning": A simple, 1-2 sentence explanation of why this is suitable now (weather, soil, season).
      3. "steps": An array of cultivation steps strictly ordered as: Land Preparation, Seed Selection, Fertilizer Schedule, Irrigation, Pest/Disease Control, and Harvest.
         - Each step should have: "stage" (name of stage), "instructions" (what to do), "estimatedDays" (how long it takes), and an "alert" (preventive warning for pests/diseases at this stage).
      
      Respond ONLY with valid JSON. Do not include markdown formatting blocks outside the JSON.
    `;

    // 3. Call the Gemini API
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    // 4. Parse the AI response
    const rawText = response.text.replace(/```json/g, '').replace(/```/g, '').trim();
    const recommendations = JSON.parse(rawText);

    // 5. Save to MongoDB for future use
    const newGuide = new CropGuide({ district, month, language, recommendations });
    await newGuide.save();

    // 6. Send to frontend
    res.status(200).json({ success: true, data: recommendations });

  } catch (error) {
    console.error("Error generating recommendations:", error);
    res.status(500).json({ success: false, message: "Failed to process cultivation guidance." });
  }
};