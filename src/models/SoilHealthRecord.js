const mongoose = require('mongoose');

const soilHealthRecordSchema = new mongoose.Schema(
  {
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    request: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SoilHealthRequest'
    },
    mode: {
      type: String,
      enum: ['image_only', 'full_fusion'],
      required: true
    },
    district: {
      type: String,
      required: true
    },
    location: String,
    cropType: String,
    season: String,
    landSize: Number,
    imageMetrics: {
      brightness: Number,
      textureScore: Number,
      redMean: Number,
      greenMean: Number,
      blueMean: Number
    },
    sensorReadings: {
      ph: Number,
      nitrogen: Number,
      phosphorus: Number,
      potassium: Number,
      moisture: Number,
      organicMatter: Number
    },
    result: {
      score: Number,
      classification: String,
      confidence: Number,
      soilType: String,
      agroZone: String,
      readings: {
        ph: Number,
        nitrogen: Number,
        phosphorus: Number,
        potassium: Number,
        moisture: Number,
        organicMatter: Number
      },
      levels: {
        ph: String,
        nitrogen: String,
        phosphorus: String,
        potassium: String,
        moisture: String,
        organicMatter: String
      },
      parameterScores: {
        ph: Number,
        nitrogen: Number,
        phosphorus: Number,
        potassium: Number,
        moisture: Number,
        organicMatter: Number
      },
      recommendations: [String]
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SoilHealthRecord', soilHealthRecordSchema);
