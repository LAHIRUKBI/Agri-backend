const mongoose = require('mongoose');

const rotationPlanSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetCrop: { type: String, required: true },
  currentMonth: { type: String, required: true },
  pastCrops: [{
    cropName: String,
    timePeriod: String,
    fertilizers: String,
    pesticides: String
  }],
  soilCondition: {
    status: String,
    details: [String]
  },
  targetEvaluation: {
    isSuitable: Boolean,
    feedback: [String]
  },
  alternativeSuggestions: [{
    cropName: String,
    reasons: [String]
  }],
  // New Table 1: Current Soil Condition & Depletion Prediction
  soilNutrientLevels: [{
    nutrient: String,
    level: String,
    depletionPrediction: String
  }],
  // New Table 2: Required Nutrients
  requiredNutrients: [{
    nutrient: String,
    recommendedSource: String,
    amount: String
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RotationPlan', rotationPlanSchema);