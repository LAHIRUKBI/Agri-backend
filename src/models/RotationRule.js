// backend/src/models/RotationRule.js
const mongoose = require('mongoose');

const rotationRuleSchema = new mongoose.Schema({
  ruleName: String,
  description: String,
  sequence: [String], // e.g., ["Legumes", "Brassicas", "Alliums"]
  source: String,
  fetchedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['pending', 'approved', 'ignored'], default: 'pending' }
});

module.exports = mongoose.model('RotationRule', rotationRuleSchema);