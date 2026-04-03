const mongoose = require('mongoose');

const rotationPlanSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetCrop: { type: String, required: true },
  currentMonth: { type: String, required: true },
  pastCrops: [{
    cropName: String,
    startMonth: String,
    startYear: String,
    endMonth: String,
    endYear: String,
    fertilizers: String,
    pesticides: String
  }],
  targetEvaluation: {
    isSuitable: Boolean,
    feedback: [String],
    aiSoilRemedy: String // ADDED: Frontend needs this to render the ✨ AI Soil Preparation Guide
  },
  soilNutrientLevels: [{
    nutrient: String,
    level: String,
    depletionPrediction: String,
    difference: Number // ADDED: Frontend relies on this for the BarChart
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RotationPlan', rotationPlanSchema);