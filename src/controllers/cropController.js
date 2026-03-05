// backend/src/controllers/cropController.js
const CropRule = require('../models/CropRule');

// GET /api/crops – return list of all crop names
exports.getAllCrops = async (req, res) => {
  try {
    const crops = await CropRule.find({}, 'name');
    res.json(crops.map(c => c.name));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

