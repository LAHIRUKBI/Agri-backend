// backend/src/models/CropGuide.js
const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  stage: String, // e.g. "Land Preparation", "Seed Selection"
  instructions: String,
  estimatedDays: Number,
  alert: String 
});

const cropRecommendationSchema = new mongoose.Schema({
  cropName: String,
  reasoning: String, // Simple explanation for the farmer
  steps: [stepSchema]
});

const cropGuideSchema = new mongoose.Schema({
  district: { type: String, required: true },
  month: { type: String, required: true },
  language: { type: String, required: true },
  recommendations: [cropRecommendationSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CropGuide', cropGuideSchema);