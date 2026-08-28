const mongoose = require("mongoose");
const SavedRecommendation = require("../models/SavedRecommendation");
const Notification = require("../models/Notification");
const {
  buildRecommendationSchedule,
} = require("../utils/recommendationTargetDate");
const {
  buildRecommendationSnapshot,
} = require("../utils/recommendationSnapshot");
const {
  generateRecommendationFingerprint,
} = require("../utils/recommendationFingerprint");
const {
  getEffectiveRecommendationStatus,
} = require("../utils/recommendationLifecycle");

const SERVER_CONTROLLED_FIELDS = new Set([
  "user",
  "user_id",
  "owner",
  "recommendation_fingerprint",
  "prediction_target_date",
  "status",
  "createdat",
  "updatedat",
  "scheduled_for",
  "delivered_at",
  "read_at",
  "token",
  "jwt",
  "authorization",
  "password",
  "api_key",
  "apikey",
  "secret",
]);

const MARKET_OUTLOOK_STATUSES = new Set([
  "UPWARD",
  "DOWNWARD",
  "MIXED",
  "STABLE",
  "LIMITED",
]);
const MARKET_OUTLOOK_STRENGTHS = new Set([
  "LOW",
  "MODERATE",
  "STRONG",
]);
const CURRENT_PRICE_SOURCES = new Set(["manual", "system"]);
const AUTOMATIC_REMINDER_TYPES = [
  "RECOMMENDATION_DUE_SOON",
  "RECOMMENDATION_DUE",
];
const CUSTOM_REMINDER_TYPE = "RECOMMENDATION_CUSTOM";

class SaveValidationError extends Error {}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const requiredText = (value, fieldName) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new SaveValidationError(`${fieldName} must be a non-empty string`);
  }

  return value.trim();
};

const positiveNumber = (value, fieldName) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new SaveValidationError(
      `${fieldName} must be a finite number greater than 0`
    );
  }

  return value;
};

const optionalNonNegativeNumber = (value, fieldName) => {
  if (value == null) return null;

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new SaveValidationError(
      `${fieldName} must be null or a finite non-negative number`
    );
  }

  return value;
};

const optionalText = (value, fieldName) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new SaveValidationError(`${fieldName} must be a string when provided`);
  }

  return value.trim() || null;
};

const rejectServerControlledFields = (payload) => {
  const unsupportedFields = Object.keys(payload).filter((field) =>
    SERVER_CONTROLLED_FIELDS.has(field.toLowerCase())
  );

  if (unsupportedFields.length > 0) {
    throw new SaveValidationError(
      "Request contains unsupported server-controlled fields"
    );
  }
};

const validateSavePayload = (payload) => {
  if (!isRecord(payload)) {
    throw new SaveValidationError("Request body must be an object");
  }

  rejectServerControlledFields(payload);

  if (
    typeof payload.recommendation_timestamp !== "string" ||
    !payload.recommendation_timestamp.trim()
  ) {
    throw new SaveValidationError(
      "recommendation_timestamp must be a valid date"
    );
  }

  const recommendationTimestamp = new Date(
    payload.recommendation_timestamp.trim()
  );
  if (!Number.isFinite(recommendationTimestamp.getTime())) {
    throw new SaveValidationError(
      "recommendation_timestamp must be a valid date"
    );
  }

  if (!isRecord(payload.recommended_market)) {
    throw new SaveValidationError("recommended_market must be an object");
  }

  if (!isRecord(payload.market_outlook)) {
    throw new SaveValidationError("market_outlook must be an object");
  }

  const currentPriceSource = requiredText(
    payload.current_price_source,
    "current_price_source"
  ).toLowerCase();
  if (!CURRENT_PRICE_SOURCES.has(currentPriceSource)) {
    throw new SaveValidationError(
      "current_price_source must be manual or system"
    );
  }

  const marketOutlookStatus = requiredText(
    payload.market_outlook.status,
    "market_outlook.status"
  );
  if (!MARKET_OUTLOOK_STATUSES.has(marketOutlookStatus)) {
    throw new SaveValidationError("market_outlook.status is invalid");
  }

  const marketOutlookStrength = requiredText(
    payload.market_outlook.strength,
    "market_outlook.strength"
  );
  if (!MARKET_OUTLOOK_STRENGTHS.has(marketOutlookStrength)) {
    throw new SaveValidationError("market_outlook.strength is invalid");
  }

  if (typeof payload.action_authorized !== "boolean") {
    throw new SaveValidationError("action_authorized must be a boolean");
  }

  if (payload.horizon !== 1) {
    throw new SaveValidationError("horizon must be 1");
  }

  return {
    recommendationTimestamp,
    crop: requiredText(payload.crop, "crop"),
    farmerDistrict: requiredText(payload.farmer_district, "farmer_district"),
    recommendedMarket: requiredText(
      payload.recommended_market.market,
      "recommended_market.market"
    ),
    currentPrice: positiveNumber(payload.current_price, "current_price"),
    currentPriceSource,
    experimentalPrice: optionalNonNegativeNumber(
      payload.experimental_price,
      "experimental_price"
    ),
    persistenceBaseline: optionalNonNegativeNumber(
      payload.persistence_baseline,
      "persistence_baseline"
    ),
    quantityKg: positiveNumber(payload.quantity_kg, "quantity_kg"),
    horizon: payload.horizon,
    marketOutlookStatus,
    marketOutlookStrength,
    actionDecision: requiredText(
      payload.action_decision,
      "action_decision"
    ),
    actionAuthorized: payload.action_authorized,
    modelVersion: optionalText(payload.model_version, "model_version"),
    policyVersion: optionalText(payload.policy_version, "policy_version"),
  };
};

const buildSnapshotInput = (payload, validated) => ({
  crop: validated.crop,
  farmer_district: validated.farmerDistrict,
  available_markets: payload.available_markets,
  comparisons: payload.comparisons,
  recommended_market: payload.recommended_market,
  current_price: validated.currentPrice,
  current_price_source: validated.currentPriceSource,
  experimental_price: validated.experimentalPrice,
  persistence_baseline: validated.persistenceBaseline,
  market_outlook: payload.market_outlook,
  action_decision: validated.actionDecision,
  action_authorized: validated.actionAuthorized,
  quantity_kg: validated.quantityKg,
  ai_insights: payload.ai_insights,
  weather_forecast: payload.weather_forecast,
  model_version: validated.modelVersion,
  policy_version: validated.policyVersion,
  horizon: validated.horizon,
});

const formatCropName = (crop) =>
  crop ? `${crop.charAt(0).toUpperCase()}${crop.slice(1)}` : crop;

const buildNotificationDocuments = ({
  userId,
  recommendationId,
  crop,
  recommendedMarket,
  dueSoonDate,
  dueDate,
}) => {
  const cropName = formatCropName(crop);

  return [
    {
      user: userId,
      recommendation: recommendationId,
      type: "RECOMMENDATION_DUE_SOON",
      title: `${cropName} recommendation due tomorrow`,
      message: `Your saved recommendation for ${recommendedMarket} reaches its next market period tomorrow. Check current buyer prices and market conditions before deciding.`,
      scheduled_for: dueSoonDate,
    },
    {
      user: userId,
      recommendation: recommendationId,
      type: "RECOMMENDATION_DUE",
      title: `${cropName} recommendation period reached`,
      message:
        "Your saved recommendation has reached its next market period. Check current buyer prices and market conditions before deciding.",
      scheduled_for: dueDate,
    },
  ];
};

const savedRecommendationSummary = (recommendation) => ({
  id: String(recommendation._id),
  crop: recommendation.crop,
  recommended_market: recommendation.recommended_market,
  prediction_target_date: recommendation.prediction_target_date,
  status: recommendation.status,
  created_at: recommendation.createdAt,
});

const reminderSummary = (reminder) => ({
  id: String(reminder._id),
  type: reminder.type,
  scheduled_for: reminder.scheduled_for,
});

const isDuplicateKeyError = (error) => error?.code === 11000;

const savedRecommendationListSummary = (
  recommendation,
  now,
  reminder = null
) => ({
  id: String(recommendation._id),
  crop: recommendation.crop,
  farmer_district: recommendation.farmer_district,
  recommended_market: recommendation.recommended_market,
  current_price: recommendation.current_price,
  experimental_price: recommendation.experimental_price,
  quantity_kg: recommendation.quantity_kg,
  market_outlook_status: recommendation.market_outlook_status,
  market_outlook_strength: recommendation.market_outlook_strength,
  prediction_target_date: recommendation.prediction_target_date,
  status: getEffectiveRecommendationStatus({
    storedStatus: recommendation.status,
    predictionTargetDate: recommendation.prediction_target_date,
    now,
  }),
  created_at: recommendation.createdAt,
  reminder: reminder ? reminderSummary(reminder) : null,
});

const savedRecommendationDetail = (recommendation, now, reminder = null) => ({
  id: String(recommendation._id),
  crop: recommendation.crop,
  farmer_district: recommendation.farmer_district,
  recommended_market: recommendation.recommended_market,
  current_price: recommendation.current_price,
  current_price_source: recommendation.current_price_source,
  experimental_price: recommendation.experimental_price,
  persistence_baseline: recommendation.persistence_baseline,
  quantity_kg: recommendation.quantity_kg,
  market_outlook_status: recommendation.market_outlook_status,
  market_outlook_strength: recommendation.market_outlook_strength,
  action_decision: recommendation.action_decision,
  action_authorized: recommendation.action_authorized,
  model_version: recommendation.model_version,
  policy_version: recommendation.policy_version,
  prediction_target_date: recommendation.prediction_target_date,
  status: getEffectiveRecommendationStatus({
    storedStatus: recommendation.status,
    predictionTargetDate: recommendation.prediction_target_date,
    now,
  }),
  created_at: recommendation.createdAt,
  updated_at: recommendation.updatedAt,
  recommendation_snapshot: recommendation.recommendation_snapshot,
  reminder: reminder ? reminderSummary(reminder) : null,
});

const sendNotFound = (res) =>
  res.status(404).json({
    success: false,
    message: "Saved recommendation not found",
  });

const hasValidRecommendationId = (id) =>
  Boolean(id && mongoose.isObjectIdOrHexString(id));

const createSaveRecommendationController = ({
  SavedRecommendationModel = SavedRecommendation,
  NotificationModel = Notification,
  now = () => new Date(),
  scheduleBuilder = buildRecommendationSchedule,
  snapshotBuilder = buildRecommendationSnapshot,
  fingerprintGenerator = generateRecommendationFingerprint,
} = {}) => {
  const findReminderSummaries = async (userId, recommendationId) => {
    const reminders = await NotificationModel.find({
      user: userId,
      recommendation: recommendationId,
    });

    return [...reminders]
      .sort(
        (left, right) =>
          new Date(left.scheduled_for).getTime() -
          new Date(right.scheduled_for).getTime()
      )
      .map(reminderSummary);
  };

  const sendExisting = async (res, userId, recommendation) => {
    const reminders = await findReminderSummaries(userId, recommendation._id);
    return res.status(200).json({
      success: true,
      already_saved: true,
      saved_recommendation: savedRecommendationSummary(recommendation),
      reminders,
    });
  };

  return async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    let validated;
    try {
      validated = validateSavePayload(req.body);
    } catch (error) {
      if (error instanceof SaveValidationError) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }
      return res.status(500).json({
        success: false,
        message: "Unable to save recommendation",
      });
    }

    try {
      const fingerprint = fingerprintGenerator({
        userId,
        recommendationTimestamp: validated.recommendationTimestamp,
        crop: validated.crop,
        recommendedMarket: validated.recommendedMarket,
        currentPrice: validated.currentPrice,
        experimentalPrice: validated.experimentalPrice,
      });

      const existing = await SavedRecommendationModel.findOne({
        user: userId,
        recommendation_fingerprint: fingerprint,
      });
      if (existing) return sendExisting(res, userId, existing);

      const savedAt = now();
      const { predictionTargetDate, dueSoonDate, dueDate } =
        scheduleBuilder(savedAt);
      const recommendationSnapshot = snapshotBuilder(
        buildSnapshotInput(req.body, validated)
      );

      let savedRecommendation;
      try {
        savedRecommendation = await SavedRecommendationModel.create({
          user: userId,
          crop: validated.crop,
          farmer_district: validated.farmerDistrict,
          recommended_market: validated.recommendedMarket,
          current_price: validated.currentPrice,
          current_price_source: validated.currentPriceSource,
          experimental_price: validated.experimentalPrice,
          persistence_baseline: validated.persistenceBaseline,
          quantity_kg: validated.quantityKg,
          horizon: validated.horizon,
          market_outlook_status: validated.marketOutlookStatus,
          market_outlook_strength: validated.marketOutlookStrength,
          action_decision: validated.actionDecision,
          action_authorized: validated.actionAuthorized,
          model_version: validated.modelVersion,
          policy_version: validated.policyVersion,
          prediction_target_date: predictionTargetDate,
          status: "ACTIVE",
          recommendation_fingerprint: fingerprint,
          recommendation_snapshot: recommendationSnapshot,
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          const racedExisting = await SavedRecommendationModel.findOne({
            user: userId,
            recommendation_fingerprint: fingerprint,
          });
          if (racedExisting) return sendExisting(res, userId, racedExisting);
        }
        throw error;
      }

      const notificationDocuments = buildNotificationDocuments({
        userId,
        recommendationId: savedRecommendation._id,
        crop: validated.crop,
        recommendedMarket: validated.recommendedMarket,
        dueSoonDate,
        dueDate,
      });

      let reminders;
      try {
        reminders = await NotificationModel.insertMany(notificationDocuments);
      } catch (error) {
        await Promise.allSettled([
          NotificationModel.deleteMany({
            recommendation: savedRecommendation._id,
          }),
          SavedRecommendationModel.deleteOne({
            _id: savedRecommendation._id,
            user: userId,
          }),
        ]);
        throw error;
      }

      return res.status(201).json({
        success: true,
        already_saved: false,
        saved_recommendation:
          savedRecommendationSummary(savedRecommendation),
        reminders: reminders.map(reminderSummary),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to save recommendation",
      });
    }
  };
};

const saveRecommendation = createSaveRecommendationController();

const createSavedRecommendationReadControllers = ({
  SavedRecommendationModel = SavedRecommendation,
  NotificationModel = Notification,
  now = () => new Date(),
} = {}) => {
  const findCustomReminderMap = async (userId, recommendationIds) => {
    if (recommendationIds.length === 0) return new Map();

    const reminders = await NotificationModel.find({
      user: userId,
      recommendation: { $in: recommendationIds },
      type: CUSTOM_REMINDER_TYPE,
      active: { $ne: false },
    });

    return new Map(
      reminders.map((reminder) => [String(reminder.recommendation), reminder])
    );
  };

  const listSavedRecommendations = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    try {
      const recommendations = await SavedRecommendationModel.find({
        user: userId,
        status: { $ne: "ARCHIVED" },
      }).sort({ createdAt: -1 });
      const requestTime = now();
      const remindersByRecommendation = await findCustomReminderMap(
        userId,
        recommendations.map((recommendation) => recommendation._id)
      );

      return res.status(200).json({
        success: true,
        saved_recommendations: recommendations.map((recommendation) =>
          savedRecommendationListSummary(
            recommendation,
            requestTime,
            remindersByRecommendation.get(String(recommendation._id))
          )
        ),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to list saved recommendations",
      });
    }
  };

  const getSavedRecommendation = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    const recommendationId = req.params?.id;
    if (!hasValidRecommendationId(recommendationId)) {
      return sendNotFound(res);
    }

    try {
      const recommendation = await SavedRecommendationModel.findOne({
        _id: recommendationId,
        user: userId,
      });
      if (!recommendation) return sendNotFound(res);

      const reminder =
        recommendation.status === "ARCHIVED"
          ? null
          : await NotificationModel.findOne({
              user: userId,
              recommendation: recommendation._id,
              type: CUSTOM_REMINDER_TYPE,
              active: { $ne: false },
            });

      return res.status(200).json({
        success: true,
        saved_recommendation: savedRecommendationDetail(
          recommendation,
          now(),
          reminder
        ),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to read saved recommendation",
      });
    }
  };

  const archiveSavedRecommendation = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    const recommendationId = req.params?.id;
    if (!hasValidRecommendationId(recommendationId)) {
      return sendNotFound(res);
    }

    try {
      const recommendation =
        await SavedRecommendationModel.findOneAndUpdate(
          {
            _id: recommendationId,
            user: userId,
          },
          {
            $set: { status: "ARCHIVED" },
          },
          {
            new: true,
          }
        );
      if (!recommendation) return sendNotFound(res);

      return res.status(200).json({
        success: true,
        message: "Recommendation archived",
        saved_recommendation: {
          id: String(recommendation._id),
          status: "ARCHIVED",
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to archive saved recommendation",
      });
    }
  };

  return {
    listSavedRecommendations,
    getSavedRecommendation,
    archiveSavedRecommendation,
  };
};

class ReminderValidationError extends Error {}

const validateReminderPayload = (payload, requestTime) => {
  if (!isRecord(payload)) {
    throw new ReminderValidationError("Request body must be an object");
  }

  const unsupportedFields = Object.keys(payload).filter(
    (field) => field !== "scheduled_for"
  );
  if (unsupportedFields.length > 0) {
    throw new ReminderValidationError(
      "Request contains unsupported reminder fields"
    );
  }

  const scheduledForText =
    typeof payload.scheduled_for === "string"
      ? payload.scheduled_for.trim()
      : "";
  const isoMatch =
    /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i.exec(
      scheduledForText
    );
  if (!isoMatch) {
    throw new ReminderValidationError(
      "scheduled_for must be a valid ISO datetime"
    );
  }

  const [, yearText, monthText, dayText] = isoMatch;
  const calendarDate = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText))
  );
  const scheduledFor = new Date(scheduledForText);
  if (
    !Number.isFinite(scheduledFor.getTime()) ||
    calendarDate.getUTCFullYear() !== Number(yearText) ||
    calendarDate.getUTCMonth() + 1 !== Number(monthText) ||
    calendarDate.getUTCDate() !== Number(dayText)
  ) {
    throw new ReminderValidationError(
      "scheduled_for must be a valid ISO datetime"
    );
  }
  if (scheduledFor.getTime() <= requestTime.getTime()) {
    throw new ReminderValidationError(
      "scheduled_for must be strictly in the future"
    );
  }

  return scheduledFor;
};

const buildCustomReminderCopy = (recommendation) => ({
  title: "Recommendation reminder",
  message: `Review your saved ${formatCropName(
    recommendation.crop
  )} recommendation for ${recommendation.recommended_market}.`,
});

const createRecommendationReminderControllers = ({
  SavedRecommendationModel = SavedRecommendation,
  NotificationModel = Notification,
  now = () => new Date(),
} = {}) => {
  const findOwnedActiveRecommendation = async (recommendationId, userId) =>
    SavedRecommendationModel.findOne({
      _id: recommendationId,
      user: userId,
      status: { $ne: "ARCHIVED" },
    });

  const getRecommendationReminder = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    const recommendationId = req.params?.id;
    if (!hasValidRecommendationId(recommendationId)) {
      return sendNotFound(res);
    }

    try {
      const recommendation = await findOwnedActiveRecommendation(
        recommendationId,
        userId
      );
      if (!recommendation) return sendNotFound(res);

      const reminder = await NotificationModel.findOne({
        user: userId,
        recommendation: recommendation._id,
        type: CUSTOM_REMINDER_TYPE,
        active: { $ne: false },
      });

      return res.status(200).json({
        success: true,
        reminder: reminder ? reminderSummary(reminder) : null,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to read recommendation reminder",
      });
    }
  };

  const scheduleRecommendationReminder = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    const recommendationId = req.params?.id;
    if (!hasValidRecommendationId(recommendationId)) {
      return sendNotFound(res);
    }

    try {
      const recommendation = await findOwnedActiveRecommendation(
        recommendationId,
        userId
      );
      if (!recommendation) return sendNotFound(res);

      const requestTime = now();
      const scheduledFor = validateReminderPayload(req.body, requestTime);
      const copy = buildCustomReminderCopy(recommendation);

      await NotificationModel.updateMany(
        {
          user: userId,
          recommendation: recommendation._id,
          type: { $in: AUTOMATIC_REMINDER_TYPES },
          active: { $ne: false },
        },
        { $set: { active: false } }
      );

      const reminder = await NotificationModel.findOneAndUpdate(
        {
          recommendation: recommendation._id,
          type: CUSTOM_REMINDER_TYPE,
        },
        {
          $set: {
            user: userId,
            scheduled_for: scheduledFor,
            title: copy.title,
            message: copy.message,
            delivered_at: null,
            read_at: null,
            active: true,
          },
          $setOnInsert: {
            recommendation: recommendation._id,
            type: CUSTOM_REMINDER_TYPE,
          },
        },
        {
          new: true,
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

      return res.status(200).json({
        success: true,
        reminder: reminderSummary(reminder),
      });
    } catch (error) {
      if (error instanceof ReminderValidationError) {
        return res.status(400).json({
          success: false,
          message: error.message,
        });
      }

      return res.status(500).json({
        success: false,
        message: "Unable to schedule recommendation reminder",
      });
    }
  };

  const cancelRecommendationReminder = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    const recommendationId = req.params?.id;
    if (!hasValidRecommendationId(recommendationId)) {
      return sendNotFound(res);
    }

    try {
      const recommendation = await findOwnedActiveRecommendation(
        recommendationId,
        userId
      );
      if (!recommendation) return sendNotFound(res);

      await NotificationModel.findOneAndUpdate(
        {
          user: userId,
          recommendation: recommendation._id,
          type: CUSTOM_REMINDER_TYPE,
          active: { $ne: false },
        },
        { $set: { active: false } },
        { new: true }
      );

      return res.status(200).json({
        success: true,
        reminder: null,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to cancel recommendation reminder",
      });
    }
  };

  return {
    getRecommendationReminder,
    scheduleRecommendationReminder,
    cancelRecommendationReminder,
  };
};

const {
  listSavedRecommendations,
  getSavedRecommendation,
  archiveSavedRecommendation,
} = createSavedRecommendationReadControllers();
const {
  getRecommendationReminder,
  scheduleRecommendationReminder,
  cancelRecommendationReminder,
} = createRecommendationReminderControllers();

module.exports = {
  saveRecommendation,
  createSaveRecommendationController,
  listSavedRecommendations,
  getSavedRecommendation,
  archiveSavedRecommendation,
  createSavedRecommendationReadControllers,
  getRecommendationReminder,
  scheduleRecommendationReminder,
  cancelRecommendationReminder,
  createRecommendationReminderControllers,
};
