const mongoose = require("mongoose");

const isFinitePositiveNumber = (value) =>
  Number.isFinite(value) && value > 0;

const isFiniteNonNegativeNumber = (value) =>
  value == null || (Number.isFinite(value) && value >= 0);

const savedRecommendationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    crop: {
      type: String,
      required: true,
      trim: true,
    },
    farmer_district: {
      type: String,
      required: true,
      trim: true,
    },
    recommended_market: {
      type: String,
      required: true,
      trim: true,
    },
    current_price: {
      type: Number,
      required: true,
      validate: {
        validator: isFinitePositiveNumber,
        message: "current_price must be a finite number greater than 0",
      },
    },
    current_price_source: {
      type: String,
      required: true,
      enum: ["manual", "system"],
    },
    experimental_price: {
      type: Number,
      default: null,
      validate: {
        validator: isFiniteNonNegativeNumber,
        message: "experimental_price must be a finite non-negative number",
      },
    },
    persistence_baseline: {
      type: Number,
      default: null,
      validate: {
        validator: isFiniteNonNegativeNumber,
        message: "persistence_baseline must be a finite non-negative number",
      },
    },
    quantity_kg: {
      type: Number,
      required: true,
      validate: {
        validator: isFinitePositiveNumber,
        message: "quantity_kg must be a finite number greater than 0",
      },
    },
    horizon: {
      type: Number,
      required: true,
      enum: [1],
    },
    market_outlook_status: {
      type: String,
      required: true,
      enum: ["UPWARD", "DOWNWARD", "MIXED", "STABLE", "LIMITED"],
    },
    market_outlook_strength: {
      type: String,
      required: true,
      enum: ["LOW", "MODERATE", "STRONG"],
    },
    action_decision: {
      type: String,
      required: true,
      trim: true,
    },
    action_authorized: {
      type: Boolean,
      required: true,
    },
    model_version: {
      type: String,
      trim: true,
      default: null,
    },
    policy_version: {
      type: String,
      trim: true,
      default: null,
    },
    prediction_target_date: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: ["ACTIVE", "DUE_SOON", "DUE", "ARCHIVED"],
      default: "ACTIVE",
      index: true,
    },
    recommendation_fingerprint: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
    },
    recommendation_snapshot: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true }
);

savedRecommendationSchema.index(
  { user: 1, recommendation_fingerprint: 1 },
  { unique: true }
);
savedRecommendationSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model(
  "SavedRecommendation",
  savedRecommendationSchema
);
