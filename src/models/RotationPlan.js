const mongoose = require('mongoose');

const chemicalSchema = new mongoose.Schema({
  name: String,
  amount_g: Number
}, { _id: false });

const rotationPlanSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetCrop: { type: String, required: true },
  targetLandSize: { type: Number, required: true }, // Added land size
  currentMonth: { type: String, required: true },
  pastCrops: [{
    cropName: String,
    landSize: Number, // Added land size
    startMonth: String,
    startYear: String,
    endMonth: String,
    endYear: String,
    fertilizers: [chemicalSchema], // Changed to Array
    pesticides: [chemicalSchema]   // Changed to Array
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
  alternativeSuggestions: [{ // Added for alternatives
    cropName: String,
    reasons: [String]
  }],
  chemicalBreakdown: Array,
  calculatorDetails: Object,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('RotationPlan', rotationPlanSchema);