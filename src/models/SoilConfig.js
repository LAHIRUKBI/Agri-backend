// backend/src/models/SoilConfig.js
const mongoose = require('mongoose');

const nutrientSchema = new mongoose.Schema({
  name: String,
  symbol: String,
  type: { type: String, enum: ['main', 'secondary', 'other'] },
  min: Number,
  max: Number,
  unit: { type: String, default: 'ppm' }
});

const soilConfigSchema = new mongoose.Schema({
  phMin: { type: Number, default: 6.0 },
  phMax: { type: Number, default: 7.0 },
  nutrients: [nutrientSchema]
});

module.exports = mongoose.model('SoilConfig', soilConfigSchema);