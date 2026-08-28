const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

require("dotenv").config({ quiet: true, override: true });

const User = require("../../src/models/User");
const SavedRecommendation = require(
  "../../src/models/SavedRecommendation"
);
const Notification = require("../../src/models/Notification");
const marketRecommendationRoutes = require(
  "../../src/routes/marketRecommendationRoutes"
);
const notificationRoutes = require(
  "../../src/routes/notificationRoutes"
);

const EXPECTED_DATABASE = "agri_backend_dev";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const RUN_REAL_DB_INTEGRATION =
  process.env.RUN_REAL_DB_INTEGRATION === "true";

const hasOwn = (value, key) =>
  Object.prototype.hasOwnProperty.call(value, key);

const assertAbsentKeys = (value, keys) => {
  for (const key of keys) {
    assert.equal(hasOwn(value, key), false, `${key} must not be exposed`);
  }
};

const collectObjectKeys = (value, output = []) => {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, output);
    return output;
  }

  if (!value || typeof value !== "object") return output;

  for (const [key, nestedValue] of Object.entries(value)) {
    output.push(key.toLowerCase());
    collectObjectKeys(nestedValue, output);
  }

  return output;
};

const listen = (app) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });

const closeServer = (server) =>
  new Promise((resolve, reject) => {
    if (!server) return resolve();
    return server.close((error) => (error ? reject(error) : resolve()));
  });

const requestJson = async ({ baseUrl, method, path, token, body }) => {
  const headers = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseBody = await response.json();

  return { status: response.status, body: responseBody };
};

const integrationTest = RUN_REAL_DB_INTEGRATION ? test : test.skip;

integrationTest(
  "real MongoDB saved recommendation and notification lifecycle is secure and cleanup-safe",
  { timeout: 120000 },
  async () => {
    const testRunId = `sell-advisor-${Date.now()}-${crypto
      .randomUUID()
      .replaceAll("-", "")}`;
    const emails = [
      `${testRunId}-farmer-a@example.invalid`,
      `${testRunId}-farmer-b@example.invalid`,
    ];
    const farmerIds = [];
    const recommendationIds = [];
    let server;
    let cleanupCounts = null;

    try {
      const configuredUri = new URL(process.env.MONGODB_URI);
      assert.equal(configuredUri.pathname, `/${EXPECTED_DATABASE}`);
      assert.ok(process.env.JWT_SECRET, "JWT_SECRET must be configured");

      await mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 15000,
      });
      assert.equal(mongoose.connection.name, EXPECTED_DATABASE);
      assert.equal(mongoose.connection.readyState, 1);

      const farmerA = await User.create({
        name: `Sell Advisor Integration Farmer A ${testRunId}`,
        email: emails[0],
        password: crypto.randomBytes(24).toString("hex"),
        role: "farmer",
      });
      farmerIds.push(farmerA._id);

      const farmerB = await User.create({
        name: `Sell Advisor Integration Farmer B ${testRunId}`,
        email: emails[1],
        password: crypto.randomBytes(24).toString("hex"),
        role: "farmer",
      });
      farmerIds.push(farmerB._id);

      const farmerAToken = jwt.sign(
        { id: farmerA._id },
        process.env.JWT_SECRET,
        { expiresIn: "10m" }
      );
      const farmerBToken = jwt.sign(
        { id: farmerB._id },
        process.env.JWT_SECRET,
        { expiresIn: "10m" }
      );

      const app = express();
      app.use(express.json());
      app.use("/api", marketRecommendationRoutes);
      app.use("/api/notifications", notificationRoutes);
      server = await listen(app);
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const recommendationTimestamp = new Date().toISOString();
      const savePayload = {
        recommendation_timestamp: recommendationTimestamp,
        crop: "beans",
        farmer_district: "kandy",
        available_markets: ["kandy"],
        comparisons: [
          {
            market: "kandy",
            predicted_price_rs_kg: 215,
          },
        ],
        recommended_market: {
          market: "kandy",
          predicted_price_rs_kg: 215,
        },
        current_price: 200,
        current_price_source: "manual",
        experimental_price: 215,
        persistence_baseline: 200,
        quantity_kg: 100,
        horizon: 1,
        market_outlook: {
          status: "UPWARD",
          strength: "MODERATE",
          signal_alignment: "ALIGNED",
          price_signal: "UP",
          direction_signal: "UP",
          confidence: 0.7,
          summary: "Integration-test evidence only.",
        },
        action_decision: "UNCERTAIN",
        action_authorized: false,
        model_version: "run_001",
        policy_version: "persistence_primary_v1",
        ai_insights: {
          recommendation:
            "Check current buyer prices and market conditions before deciding.",
        },
      };

      const saveResponse = await requestJson({
        baseUrl,
        method: "POST",
        path: "/api/recommend-market/saved",
        token: farmerAToken,
        body: savePayload,
      });
      assert.equal(saveResponse.status, 201);
      assert.equal(saveResponse.body.success, true);
      assert.equal(saveResponse.body.already_saved, false);

      const savedRecommendationId =
        saveResponse.body.saved_recommendation.id;
      assert.ok(mongoose.isObjectIdOrHexString(savedRecommendationId));
      recommendationIds.push(new mongoose.Types.ObjectId(savedRecommendationId));

      const persisted = await SavedRecommendation.findById(
        savedRecommendationId
      );
      assert.ok(persisted);
      assert.equal(String(persisted.user), String(farmerA._id));
      assert.equal(persisted.crop, "beans");
      assert.equal(persisted.farmer_district, "kandy");
      assert.equal(persisted.recommended_market, "kandy");
      assert.equal(persisted.current_price, 200);
      assert.equal(persisted.current_price_source, "manual");
      assert.equal(persisted.experimental_price, 215);
      assert.equal(persisted.persistence_baseline, 200);
      assert.equal(persisted.quantity_kg, 100);
      assert.equal(persisted.horizon, 1);
      assert.equal(persisted.market_outlook_status, "UPWARD");
      assert.equal(persisted.market_outlook_strength, "MODERATE");
      assert.equal(persisted.action_decision, "UNCERTAIN");
      assert.equal(persisted.action_authorized, false);
      assert.equal(persisted.model_version, "run_001");
      assert.equal(persisted.policy_version, "persistence_primary_v1");
      assert.equal(persisted.status, "ACTIVE");
      assert.match(persisted.recommendation_fingerprint, /^[a-f0-9]{64}$/);
      assert.ok(persisted.recommendation_snapshot);
      assert.ok(persisted.createdAt instanceof Date);
      assert.ok(persisted.updatedAt instanceof Date);

      const targetDifference =
        persisted.prediction_target_date.getTime() -
        persisted.createdAt.getTime();
      assert.ok(
        Math.abs(targetDifference - SEVEN_DAYS_MS) < 5000,
        "target date must be based on the server save time"
      );

      const snapshot = persisted.recommendation_snapshot;
      assert.equal(snapshot.crop, "beans");
      assert.equal(snapshot.farmer_district, "kandy");
      assert.equal(snapshot.recommended_market.market, "kandy");
      assert.equal(snapshot.current_price, 200);
      assert.equal(snapshot.quantity_kg, 100);
      assert.equal(snapshot.market_outlook.status, "UPWARD");
      assert.equal(snapshot.action_decision, "UNCERTAIN");
      assert.equal(
        snapshot.ai_insights.recommendation,
        "Check current buyer prices and market conditions before deciding."
      );

      const forbiddenTopLevelSnapshotKeys = [
        "user",
        "user_id",
        "token",
        "jwt",
        "authorization",
        "password",
        "api_key",
        "secret",
        "jwt_secret",
        "mongodb_uri",
        "recommendation_fingerprint",
        "prediction_target_date",
        "status",
        "scheduled_for",
      ];
      assertAbsentKeys(snapshot, forbiddenTopLevelSnapshotKeys);

      const recursivelyForbiddenSnapshotKeys = new Set(
        forbiddenTopLevelSnapshotKeys.filter((key) => key !== "status")
      );
      for (const key of collectObjectKeys(snapshot)) {
        assert.equal(
          recursivelyForbiddenSnapshotKeys.has(key),
          false,
          `snapshot contains forbidden key ${key}`
        );
      }

      const reminders = await Notification.find({
        recommendation: persisted._id,
      }).sort({ scheduled_for: 1 });
      assert.equal(reminders.length, 2);
      assert.deepEqual(
        new Set(reminders.map((item) => item.type)),
        new Set(["RECOMMENDATION_DUE_SOON", "RECOMMENDATION_DUE"])
      );
      for (const reminder of reminders) {
        assert.equal(String(reminder.user), String(farmerA._id));
        assert.equal(String(reminder.recommendation), String(persisted._id));
        assert.equal(reminder.delivered_at, null);
        assert.equal(reminder.read_at, null);
        assert.doesNotMatch(
          `${reminder.title} ${reminder.message}`,
          /SELL_NOW|\bWAIT\b|\bHOLD\b/i
        );
      }

      const dueSoon = reminders.find(
        (item) => item.type === "RECOMMENDATION_DUE_SOON"
      );
      const due = reminders.find(
        (item) => item.type === "RECOMMENDATION_DUE"
      );
      assert.equal(
        due.scheduled_for.getTime(),
        persisted.prediction_target_date.getTime()
      );
      assert.equal(
        dueSoon.scheduled_for.getTime(),
        persisted.prediction_target_date.getTime() - ONE_DAY_MS
      );

      const duplicateResponse = await requestJson({
        baseUrl,
        method: "POST",
        path: "/api/recommend-market/saved",
        token: farmerAToken,
        body: savePayload,
      });
      assert.equal(duplicateResponse.status, 200);
      assert.equal(duplicateResponse.body.success, true);
      assert.equal(duplicateResponse.body.already_saved, true);
      assert.equal(
        duplicateResponse.body.saved_recommendation.id,
        savedRecommendationId
      );
      assert.equal(
        await SavedRecommendation.countDocuments({ user: farmerA._id }),
        1
      );
      assert.equal(
        await Notification.countDocuments({ recommendation: persisted._id }),
        2
      );

      const listResponse = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/recommend-market/saved",
        token: farmerAToken,
      });
      assert.equal(listResponse.status, 200);
      const listItem = listResponse.body.saved_recommendations.find(
        (item) => item.id === savedRecommendationId
      );
      assert.ok(listItem);
      assert.equal(listItem.crop, "beans");
      assert.equal(listItem.recommended_market, "kandy");
      assert.equal(listItem.reminder, null);
      assertAbsentKeys(listItem, [
        "user",
        "recommendation_fingerprint",
        "recommendation_snapshot",
        "__v",
      ]);

      const detailResponse = await requestJson({
        baseUrl,
        method: "GET",
        path: `/api/recommend-market/saved/${savedRecommendationId}`,
        token: farmerAToken,
      });
      assert.equal(detailResponse.status, 200);
      assert.equal(detailResponse.body.saved_recommendation.crop, "beans");
      assert.equal(detailResponse.body.saved_recommendation.reminder, null);
      assert.equal(
        detailResponse.body.saved_recommendation.recommendation_snapshot.crop,
        "beans"
      );
      assertAbsentKeys(detailResponse.body.saved_recommendation, [
        "user",
        "recommendation_fingerprint",
        "__v",
      ]);

      const crossUserDetail = await requestJson({
        baseUrl,
        method: "GET",
        path: `/api/recommend-market/saved/${savedRecommendationId}`,
        token: farmerBToken,
      });
      assert.equal(crossUserDetail.status, 404);

      const crossUserArchive = await requestJson({
        baseUrl,
        method: "DELETE",
        path: `/api/recommend-market/saved/${savedRecommendationId}`,
        token: farmerBToken,
      });
      assert.equal(crossUserArchive.status, 404);
      assert.equal(
        (await SavedRecommendation.findById(savedRecommendationId)).status,
        "ACTIVE"
      );

      const emptyReminder = await requestJson({
        baseUrl,
        method: "GET",
        path: `/api/recommend-market/saved/${savedRecommendationId}/reminder`,
        token: farmerAToken,
      });
      assert.equal(emptyReminder.status, 200);
      assert.equal(emptyReminder.body.reminder, null);

      const firstCustomTime = new Date(Date.now() + 12 * 60 * 60 * 1000);
      const scheduledReminder = await requestJson({
        baseUrl,
        method: "PUT",
        path: `/api/recommend-market/saved/${savedRecommendationId}/reminder`,
        token: farmerAToken,
        body: { scheduled_for: firstCustomTime.toISOString() },
      });
      assert.equal(scheduledReminder.status, 200);
      assert.equal(
        scheduledReminder.body.reminder.type,
        "RECOMMENDATION_CUSTOM"
      );
      const customReminderId = scheduledReminder.body.reminder.id;
      const firstCustom = await Notification.findById(customReminderId);
      assert.ok(firstCustom);
      assert.equal(String(firstCustom.user), String(farmerA._id));
      assert.equal(String(firstCustom.recommendation), savedRecommendationId);
      assert.equal(firstCustom.active, true);
      assert.equal(firstCustom.delivered_at, null);
      assert.equal(firstCustom.read_at, null);
      assert.equal(
        await Notification.countDocuments({
          recommendation: persisted._id,
          type: { $in: ["RECOMMENDATION_DUE_SOON", "RECOMMENDATION_DUE"] },
          active: { $ne: false },
        }),
        0
      );

      const enrichedList = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/recommend-market/saved",
        token: farmerAToken,
      });
      const enrichedListItem = enrichedList.body.saved_recommendations.find(
        (item) => item.id === savedRecommendationId
      );
      assert.equal(enrichedListItem.reminder.id, customReminderId);

      const secondCustomTime = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const rescheduledReminder = await requestJson({
        baseUrl,
        method: "PUT",
        path: `/api/recommend-market/saved/${savedRecommendationId}/reminder`,
        token: farmerAToken,
        body: { scheduled_for: secondCustomTime.toISOString() },
      });
      assert.equal(rescheduledReminder.status, 200);
      assert.equal(rescheduledReminder.body.reminder.id, customReminderId);
      assert.equal(
        await Notification.countDocuments({
          recommendation: persisted._id,
          type: "RECOMMENDATION_CUSTOM",
        }),
        1
      );
      const rescheduledCustom = await Notification.findById(customReminderId);
      assert.equal(rescheduledCustom.delivered_at, null);
      assert.equal(rescheduledCustom.read_at, null);

      for (const method of ["GET", "PUT", "DELETE"]) {
        const crossUserReminder = await requestJson({
          baseUrl,
          method,
          path: `/api/recommend-market/saved/${savedRecommendationId}/reminder`,
          token: farmerBToken,
          body:
            method === "PUT"
              ? { scheduled_for: secondCustomTime.toISOString() }
              : undefined,
        });
        assert.equal(crossUserReminder.status, 404);
      }

      const beforeCustomDue = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/notifications",
        token: farmerAToken,
      });
      assert.equal(beforeCustomDue.body.unread_count, 0);
      assert.deepEqual(beforeCustomDue.body.notifications, []);

      const forcedDueTime = new Date(Date.now() - 60 * 1000);
      const scheduleUpdate = await Notification.updateOne(
        {
          _id: customReminderId,
          user: farmerA._id,
          recommendation: persisted._id,
          type: "RECOMMENDATION_CUSTOM",
        },
        { $set: { scheduled_for: forcedDueTime } }
      );
      assert.equal(scheduleUpdate.matchedCount, 1);
      assert.equal(scheduleUpdate.modifiedCount, 1);

      const notificationList = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/notifications",
        token: farmerAToken,
      });
      assert.equal(notificationList.status, 200);
      assert.equal(notificationList.body.unread_count, 1);
      assert.equal(notificationList.body.notifications.length, 1);
      const visibleNotification = notificationList.body.notifications[0];
      assert.equal(visibleNotification.id, customReminderId);
      assert.equal(
        visibleNotification.type,
        "RECOMMENDATION_CUSTOM"
      );
      assert.equal(visibleNotification.recommendation.crop, "beans");
      assertAbsentKeys(visibleNotification, [
        "user",
        "recommendation_fingerprint",
        "recommendation_snapshot",
        "__v",
      ]);
      assert.equal(
        notificationList.body.notifications.some(
          (item) => [String(dueSoon._id), String(due._id)].includes(item.id)
        ),
        false
      );

      const deliveredOnce = await Notification.findById(customReminderId);
      assert.ok(deliveredOnce.delivered_at instanceof Date);
      assert.equal(deliveredOnce.read_at, null);
      const firstDeliveredAt = deliveredOnce.delivered_at.getTime();

      const secondNotificationList = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/notifications",
        token: farmerAToken,
      });
      assert.equal(secondNotificationList.status, 200);
      assert.equal(
        (await Notification.findById(customReminderId)).delivered_at.getTime(),
        firstDeliveredAt
      );

      const unreadList = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/notifications?unread=true",
        token: farmerAToken,
      });
      assert.equal(unreadList.status, 200);
      assert.equal(unreadList.body.unread_count, 1);
      assert.deepEqual(
        unreadList.body.notifications.map((item) => item.id),
        [customReminderId]
      );

      const crossUserNotificationRead = await requestJson({
        baseUrl,
        method: "PATCH",
        path: `/api/notifications/${customReminderId}/read`,
        token: farmerBToken,
      });
      assert.equal(crossUserNotificationRead.status, 404);
      assert.equal((await Notification.findById(customReminderId)).read_at, null);

      const markReadResponse = await requestJson({
        baseUrl,
        method: "PATCH",
        path: `/api/notifications/${customReminderId}/read`,
        token: farmerAToken,
      });
      assert.equal(markReadResponse.status, 200);
      const firstRead = await Notification.findById(customReminderId);
      assert.ok(firstRead.read_at instanceof Date);
      assert.equal(firstRead.delivered_at.getTime(), firstDeliveredAt);
      const firstReadAt = firstRead.read_at.getTime();

      const secondMarkReadResponse = await requestJson({
        baseUrl,
        method: "PATCH",
        path: `/api/notifications/${customReminderId}/read`,
        token: farmerAToken,
      });
      assert.equal(secondMarkReadResponse.status, 200);
      const secondRead = await Notification.findById(customReminderId);
      assert.equal(secondRead.read_at.getTime(), firstReadAt);
      assert.equal(secondRead.delivered_at.getTime(), firstDeliveredAt);

      const afterReadList = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/notifications",
        token: farmerAToken,
      });
      assert.equal(afterReadList.status, 200);
      assert.equal(afterReadList.body.unread_count, 0);
      assert.equal(afterReadList.body.notifications.length, 1);

      const cancelReminder = await requestJson({
        baseUrl,
        method: "DELETE",
        path: `/api/recommend-market/saved/${savedRecommendationId}/reminder`,
        token: farmerAToken,
      });
      assert.equal(cancelReminder.status, 200);
      assert.equal(cancelReminder.body.reminder, null);
      const secondCancelReminder = await requestJson({
        baseUrl,
        method: "DELETE",
        path: `/api/recommend-market/saved/${savedRecommendationId}/reminder`,
        token: farmerAToken,
      });
      assert.equal(secondCancelReminder.status, 200);
      assert.equal(
        await Notification.countDocuments({
          recommendation: persisted._id,
          active: { $ne: false },
        }),
        0
      );
      assert.equal(
        (await SavedRecommendation.findById(savedRecommendationId)).status,
        "ACTIVE"
      );

      const afterCancelList = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/notifications",
        token: farmerAToken,
      });
      assert.equal(afterCancelList.body.unread_count, 0);
      assert.deepEqual(afterCancelList.body.notifications, []);

      const archiveResponse = await requestJson({
        baseUrl,
        method: "DELETE",
        path: `/api/recommend-market/saved/${savedRecommendationId}`,
        token: farmerAToken,
      });
      assert.equal(archiveResponse.status, 200);
      assert.equal(
        archiveResponse.body.saved_recommendation.status,
        "ARCHIVED"
      );

      const archived = await SavedRecommendation.findById(
        savedRecommendationId
      );
      assert.ok(archived);
      assert.equal(archived.status, "ARCHIVED");
      assert.ok(archived.recommendation_snapshot);
      assert.equal(
        await Notification.countDocuments({ recommendation: archived._id }),
        3
      );

      const archivedList = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/recommend-market/saved",
        token: farmerAToken,
      });
      assert.equal(archivedList.status, 200);
      assert.equal(
        archivedList.body.saved_recommendations.some(
          (item) => item.id === savedRecommendationId
        ),
        false
      );

      const archivedDetail = await requestJson({
        baseUrl,
        method: "GET",
        path: `/api/recommend-market/saved/${savedRecommendationId}`,
        token: farmerAToken,
      });
      assert.equal(archivedDetail.status, 200);
      assert.equal(
        archivedDetail.body.saved_recommendation.status,
        "ARCHIVED"
      );
      assert.equal(archivedDetail.body.saved_recommendation.reminder, null);
      assert.equal(
        archivedDetail.body.saved_recommendation.recommendation_snapshot.crop,
        "beans"
      );

      const archivedNotifications = await requestJson({
        baseUrl,
        method: "GET",
        path: "/api/notifications",
        token: farmerAToken,
      });
      assert.equal(archivedNotifications.status, 200);
      assert.equal(archivedNotifications.body.unread_count, 0);
      assert.deepEqual(archivedNotifications.body.notifications, []);
      assert.equal(
        await Notification.countDocuments({ recommendation: archived._id }),
        3
      );

      for (const method of ["GET", "PUT", "DELETE"]) {
        const archivedReminder = await requestJson({
          baseUrl,
          method,
          path: `/api/recommend-market/saved/${savedRecommendationId}/reminder`,
          token: farmerAToken,
          body:
            method === "PUT"
              ? { scheduled_for: new Date(Date.now() + 3600000).toISOString() }
              : undefined,
        });
        assert.equal(archivedReminder.status, 404);
      }
    } finally {
      try {
        const markedUsers = await User.find({
          email: { $in: emails },
        }).select("_id");
        const cleanupUserIds = [
          ...new Set(
            [...farmerIds, ...markedUsers.map((user) => user._id)].map(String)
          ),
        ].map((id) => new mongoose.Types.ObjectId(id));

        const notificationClauses = [];
        if (cleanupUserIds.length > 0) {
          notificationClauses.push({ user: { $in: cleanupUserIds } });
        }
        if (recommendationIds.length > 0) {
          notificationClauses.push({
            recommendation: { $in: recommendationIds },
          });
        }
        if (notificationClauses.length > 0) {
          await Notification.deleteMany({ $or: notificationClauses });
        }

        const recommendationClauses = [];
        if (cleanupUserIds.length > 0) {
          recommendationClauses.push({ user: { $in: cleanupUserIds } });
        }
        if (recommendationIds.length > 0) {
          recommendationClauses.push({ _id: { $in: recommendationIds } });
        }
        if (recommendationClauses.length > 0) {
          await SavedRecommendation.deleteMany({
            $or: recommendationClauses,
          });
        }

        await User.deleteMany({ email: { $in: emails } });

        cleanupCounts = {
          farmers: await User.countDocuments({ email: { $in: emails } }),
          savedRecommendations:
            recommendationClauses.length === 0
              ? 0
              : await SavedRecommendation.countDocuments({
                  $or: recommendationClauses,
                }),
          notifications:
            notificationClauses.length === 0
              ? 0
              : await Notification.countDocuments({
                  $or: notificationClauses,
                }),
        };
        assert.deepEqual(cleanupCounts, {
          farmers: 0,
          savedRecommendations: 0,
          notifications: 0,
        });
        console.log(
          `cleanup farmers=${cleanupCounts.farmers} savedRecommendations=${cleanupCounts.savedRecommendations} notifications=${cleanupCounts.notifications}`
        );
      } catch (cleanupError) {
        console.error(
          `CLEANUP FAILURE marker=${testRunId} farmerIds=${farmerIds
            .map(String)
            .join(",")} recommendationIds=${recommendationIds
            .map(String)
            .join(",")}`
        );
        throw cleanupError;
      } finally {
        await closeServer(server);
        await mongoose.disconnect().catch(() => {});
      }
    }

  }
);
