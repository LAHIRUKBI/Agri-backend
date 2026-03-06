// backend/src/controllers/nutrientController.js
const SoilConfig = require('../models/SoilConfig');

// Get current configuration or create default if none exists
exports.getSoilConfig = async (req, res) => {
  try {
    let config = await SoilConfig.findOne();
    if (!config) {
      config = await SoilConfig.create({
        phMin: 6.0, phMax: 7.0,
        nutrients: [
          { name: 'Nitrogen', symbol: 'N', type: 'main', min: 10, max: 50 },
          { name: 'Phosphorus', symbol: 'P', type: 'main', min: 15, max: 30 },
          { name: 'Potassium', symbol: 'K', type: 'main', min: 100, max: 150 },
          { name: 'Calcium', symbol: 'Ca', type: 'secondary', min: 1000, max: 2000 },
          { name: 'Magnesium', symbol: 'Mg', type: 'secondary', min: 100, max: 250 },
          { name: 'Sulfur', symbol: 'S', type: 'secondary', min: 10, max: 50 },
        ]
      });
    }
    res.status(200).json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Update entire configuration
exports.updateSoilConfig = async (req, res) => {
  try {
    const { phMin, phMax, nutrients } = req.body;
    let config = await SoilConfig.findOne();
    config.phMin = phMin;
    config.phMax = phMax;
    config.nutrients = nutrients;
    await config.save();
    res.status(200).json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a specific nutrient
exports.deleteNutrient = async (req, res) => {
  try {
    const { nutrientId } = req.params;
    let config = await SoilConfig.findOne();
    
    if (!config) {
      return res.status(404).json({ success: false, message: "Configuration not found" });
    }

    // Filter out the nutrient that matches the ID
    config.nutrients = config.nutrients.filter(nut => nut._id.toString() !== nutrientId);
    await config.save();

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};