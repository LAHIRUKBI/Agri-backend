// backend/src/models/CropRule.js
const mongoose = require('mongoose');

const cropRuleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },        // e.g., "Maize"
  family: { type: String },                                     // e.g., "Grass"
  nutrientDemand: {
    nitrogen: { type: Number, default: 0 },                     // kg/ha or relative scale
    phosphorus: { type: Number, default: 0 },
    potassium: { type: Number, default: 0 }
  },
  isNitrogenFixer: { type: Boolean, default: false },           // legumes
  commonPests: [String],                                        // e.g., ["corn borer"]
  compatiblePredecessors: [String],                             // crops that can be planted before this
  incompatiblePredecessors: [String],                           // crops that should not precede this
  description: String                                           // general info
});

module.exports = mongoose.model('CropRule', cropRuleSchema);