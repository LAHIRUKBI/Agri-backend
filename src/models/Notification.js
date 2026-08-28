const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recommendation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SavedRecommendation",
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: [
        "RECOMMENDATION_DUE_SOON",
        "RECOMMENDATION_DUE",
        "RECOMMENDATION_CUSTOM",
      ],
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    scheduled_for: {
      type: Date,
      required: true,
      index: true,
    },
    delivered_at: {
      type: Date,
      default: null,
    },
    read_at: {
      type: Date,
      default: null,
    },
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

notificationSchema.index(
  { recommendation: 1, type: 1 },
  { unique: true }
);

module.exports = mongoose.model("Notification", notificationSchema);
