const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const SavedRecommendation = require("../models/SavedRecommendation");

const RECOMMENDATION_SUMMARY_FIELDS =
  "_id crop farmer_district recommended_market prediction_target_date";

const sendNotificationNotFound = (res) =>
  res.status(404).json({
    success: false,
    message: "Notification not found",
  });

const hasValidNotificationId = (id) =>
  Boolean(id && mongoose.isObjectIdOrHexString(id));

const recommendationSummary = (recommendation) => ({
  crop: recommendation.crop,
  farmer_district: recommendation.farmer_district,
  recommended_market: recommendation.recommended_market,
  prediction_target_date: recommendation.prediction_target_date,
});

const notificationSummary = (notification, recommendation) => ({
  id: String(notification._id),
  recommendation_id: String(notification.recommendation),
  type: notification.type,
  title: notification.title,
  message: notification.message,
  scheduled_for: notification.scheduled_for,
  delivered_at: notification.delivered_at,
  read_at: notification.read_at,
  is_read: notification.read_at != null,
  created_at: notification.createdAt,
  recommendation: recommendationSummary(recommendation),
});

const readNotificationSummary = (notification) => ({
  id: String(notification._id),
  recommendation_id: String(notification.recommendation),
  type: notification.type,
  read_at: notification.read_at,
  delivered_at: notification.delivered_at,
});

const createNotificationControllers = ({
  NotificationModel = Notification,
  SavedRecommendationModel = SavedRecommendation,
  now = () => new Date(),
} = {}) => {
  const findActiveRecommendations = (userId) =>
    SavedRecommendationModel.find({
      user: userId,
      status: { $ne: "ARCHIVED" },
    }).select(RECOMMENDATION_SUMMARY_FIELDS);

  const listNotifications = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    const requestTime = now();

    try {
      const recommendations = await findActiveRecommendations(userId);
      const recommendationIds = recommendations.map(
        (recommendation) => recommendation._id
      );

      if (recommendationIds.length === 0) {
        return res.status(200).json({
          success: true,
          unread_count: 0,
          notifications: [],
        });
      }

      const eligibilityFilter = {
        user: userId,
        recommendation: { $in: recommendationIds },
        scheduled_for: { $lte: requestTime },
        active: { $ne: false },
      };
      const listFilter = { ...eligibilityFilter };
      if (req.query?.unread === "true") listFilter.read_at = null;

      const [notifications, unreadCount] = await Promise.all([
        NotificationModel.find(listFilter).sort({ scheduled_for: -1 }),
        NotificationModel.countDocuments({
          ...eligibilityFilter,
          read_at: null,
        }),
      ]);

      const undeliveredIds = notifications
        .filter((notification) => notification.delivered_at == null)
        .map((notification) => notification._id);

      if (undeliveredIds.length > 0) {
        await NotificationModel.updateMany(
          {
            ...eligibilityFilter,
            _id: { $in: undeliveredIds },
            delivered_at: null,
          },
          {
            $set: { delivered_at: requestTime },
          }
        );

        for (const notification of notifications) {
          if (notification.delivered_at == null) {
            notification.delivered_at = new Date(requestTime);
          }
        }
      }

      const recommendationsById = new Map(
        recommendations.map((recommendation) => [
          String(recommendation._id),
          recommendation,
        ])
      );

      return res.status(200).json({
        success: true,
        unread_count: unreadCount,
        notifications: notifications.map((notification) =>
          notificationSummary(
            notification,
            recommendationsById.get(String(notification.recommendation))
          )
        ),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to list notifications",
      });
    }
  };

  const markNotificationRead = async (req, res) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(403).json({
        success: false,
        message: "Farmer access required",
      });
    }

    const notificationId = req.params?.id;
    if (!hasValidNotificationId(notificationId)) {
      return sendNotificationNotFound(res);
    }

    const requestTime = now();

    try {
      const recommendations = await findActiveRecommendations(userId);
      const recommendationIds = recommendations.map(
        (recommendation) => recommendation._id
      );
      if (recommendationIds.length === 0) {
        return sendNotificationNotFound(res);
      }

      const eligibilityFilter = {
        _id: notificationId,
        user: userId,
        recommendation: { $in: recommendationIds },
        scheduled_for: { $lte: requestTime },
        active: { $ne: false },
      };
      const notification = await NotificationModel.findOne(eligibilityFilter);
      if (!notification) return sendNotificationNotFound(res);

      if (notification.read_at != null) {
        return res.status(200).json({
          success: true,
          notification: readNotificationSummary(notification),
        });
      }

      const timestamps = { read_at: requestTime };
      if (notification.delivered_at == null) {
        timestamps.delivered_at = requestTime;
      }

      let updatedNotification = await NotificationModel.findOneAndUpdate(
        {
          ...eligibilityFilter,
          read_at: null,
        },
        {
          $set: timestamps,
        },
        {
          new: true,
        }
      );

      if (!updatedNotification) {
        updatedNotification =
          await NotificationModel.findOne(eligibilityFilter);
      }
      if (!updatedNotification) return sendNotificationNotFound(res);

      return res.status(200).json({
        success: true,
        notification: readNotificationSummary(updatedNotification),
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Unable to mark notification as read",
      });
    }
  };

  return {
    listNotifications,
    markNotificationRead,
  };
};

const {
  listNotifications,
  markNotificationRead,
} = createNotificationControllers();

module.exports = {
  listNotifications,
  markNotificationRead,
  createNotificationControllers,
};
