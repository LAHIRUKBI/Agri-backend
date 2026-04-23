const mongoose = require('mongoose');

const soilHealthRequestSchema = new mongoose.Schema(
  {
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin'
    },
    district: {
      type: String,
      required: true
    },
    location: String,
    cropType: String,
    season: String,
    landSize: Number,
    preferredDate: Date,
    scheduledDate: Date,
    farmerNotes: String,
    adminNotes: String,
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'completed'],
      default: 'pending'
    },
    imageMetrics: {
      brightness: Number,
      textureScore: Number,
      redMean: Number,
      greenMean: Number,
      blueMean: Number
    },
    imageAssessment: {
      score: Number,
      classification: String,
      confidence: Number,
      soilType: String
    },
    sensorReadings: {
      ph: Number,
      nitrogen: Number,
      phosphorus: Number,
      potassium: Number,
      moisture: Number,
      organicMatter: Number
    },
    finalRecord: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SoilHealthRecord'
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SoilHealthRequest', soilHealthRequestSchema);
