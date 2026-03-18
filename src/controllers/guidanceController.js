const axios = require('axios');
const CropGuide = require('../models/CropGuide');

exports.getRecommendations = async (req, res) => {
  try {
    // The frontend now passes the user-selected 'month' here instead of just the current month
    const { district, month, language } = req.body;

    // 1. Check MongoDB cache first (It will cleanly cache predictions for future months too!)
    const existingGuide = await CropGuide.findOne({ district, month, language });
    
    if (existingGuide) {
      const isCorrupted = existingGuide.recommendations.some(rec => 
        !rec.steps || rec.steps.length === 0 || !rec.steps[0].stage
      );
      
      if (!isCorrupted) {
        return res.status(200).json({ success: true, data: existingGuide.recommendations });
      } else {
        console.log("⚠️ Corrupted cache detected. Deleting and requesting fresh data from Python...");
        await CropGuide.deleteOne({ _id: existingGuide._id });
      }
    }

    // 2. Call the Python ML API (Passes the future month seamlessly)
    const pythonApiUrl = 'http://localhost:8000/recommend_crops'; 
    
    const response = await axios.post(pythonApiUrl, {
        district: district,
        month: month
    });

    if (response.data.error) {
        return res.status(400).json({ success: false, message: response.data.error });
    }

    const recommendations = response.data.data;

    // 3. Save clean, mapped data to MongoDB
    const newGuide = new CropGuide({ district, month, language, recommendations });
    await newGuide.save();

    // 4. Send to frontend
    res.status(200).json({ success: true, data: recommendations });

  } catch (error) {
    console.error("Error connecting to Python ML Pipeline:", error.message);
    res.status(500).json({ success: false, message: "Failed to process cultivation guidance via ML pipeline." });
  }
};