// backend/src/models/CropTracking.js
const mongoose = require('mongoose');

const stepTrackingSchema = new mongoose.Schema({
  stage: String,
  instructions: String,
  alert: String,
  estimatedDays: Number,
  startTime: Date,        // Exactly when this step begins
  endTime: Date,          // Exactly when this step ends
  isCompleted: { type: Boolean, default: false },
  notified: { type: Boolean, default: false } // To prevent spamming notifications
});

const cropTrackingSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // Links to the specific farmer
  cropName: { type: String, required: true },
  district: { type: String, required: true },
  status: { type: String, enum: ['Active', 'Completed', 'Abandoned'], default: 'Active' },
  currentStepIndex: { type: Number, default: 0 }, // Tracks which step is currently active
  steps: [stepTrackingSchema],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CropTracking', cropTrackingSchema);