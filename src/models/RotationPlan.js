const mongoose = require('mongoose');

const chemicalSchema = new mongoose.Schema({
  name: String,
  amount_g: Number
}, { _id: false });

const rotationPlanSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetCrop: { type: String, required: true },
  targetLandSize: { type: Number, required: true },
  currentMonth: { type: String, required: true },
  pastCrops: [{
    cropName: String,
    landSize: Number,
    startMonth: String,
    startYear: String,
    endMonth: String,
    endYear: String,
    fertilizers: [chemicalSchema],
    pesticides: [chemicalSchema]
  }],
  targetEvaluation: {
    isSuitable: Boolean,
    feedback: [String],
    aiSoilRemedy: String 
  },
  soilNutrientLevels: [{
    nutrient: String,
    level: String,
    depletionPrediction: String,
    difference: Number 
  }],
  alternativeSuggestions: [{
    cropName: String,
    reasons: [String]
  }],
  chemicalBreakdown: Array,
  calculatorDetails: Object,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RotationPlan', rotationPlanSchema);