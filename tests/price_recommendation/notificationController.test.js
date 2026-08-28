const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../src/models/User");
const authMiddleware = require("../../src/middlewares/authMiddleware");
const farmerAuthMiddleware = require(
  "../../src/middlewares/farmerAuthMiddleware"
);
const {
  listNotifications,
  markNotificationRead,
  createNotificationControllers,
} = require("../../src/controllers/notificationController");
const notificationRoutes = require("../../src/routes/notificationRoutes");

const FIXED_NOW = new Date("2026-09-02T04:30:00.000Z");
const FARMER_ID = new mongoose.Types.ObjectId().toString();
const OTHER_USER_ID = new mongoose.Types.ObjectId().toString();

const makeRecommendation = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  user: FARMER_ID,
  crop: "beans",
  farmer_district: "kandy",
  recommended_market: "kandy",
  prediction_target_date: new Date("2026-09-02T04:30:00.000Z"),
  status: "ACTIVE",
  recommendation_fingerprint: "not-for-notification-responses",
  recommendation_snapshot: { hidden: "historical snapshot" },
  ...overrides,
});

const makeNotification = (recommendation, overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  user: FARMER_ID,
  recommendation: recommendation._id,
  type: "RECOMMENDATION_DUE_SOON",
  title: "Beans recommendation due tomorrow",
  message:
    "Your saved recommendation reaches its next market period tomorrow. Check current buyer prices and market conditions before deciding.",
  scheduled_for: new Date("2026-09-02T04:30:00.000Z"),
  delivered_at: null,
  read_at: null,
  createdAt: new Date("2026-08-26T04:30:00.000Z"),
  updatedAt: new Date("2026-08-26T04:30:00.000Z"),
  __v: 0,
  ...overrides,
});

const makeFixture = () => {
  const active = makeRecommendation();
  const archived = makeRecommendation({ status: "ARCHIVED" });
  const other = makeRecommendation({ user: OTHER_USER_ID });
  const previousDelivery = new Date("2026-09-02T02:30:00.000Z");
  const previousRead = new Date("2026-09-02T03:00:00.000Z");

  const dueSoon = makeNotification(active);
  const due = makeNotification(active, {
    type: "RECOMMENDATION_DUE",
    title: "Beans recommendation period reached",
    message:
      "Your saved recommendation has reached its next market period. Check current buyer prices and market conditions before deciding.",
    scheduled_for: new Date("2026-09-02T03:30:00.000Z"),
    delivered_at: previousDelivery,
    read_at: previousRead,
  });
  const future = makeNotification(active, {
    type: "RECOMMENDATION_CUSTOM",
    title: "Recommendation reminder",
    message: "Review your saved Beans recommendation for kandy.",
    scheduled_for: new Date("2026-09-02T05:30:00.000Z"),
  });
  const archivedNotification = makeNotification(archived, {
    scheduled_for: new Date("2026-09-02T03:45:00.000Z"),
  });
  const otherNotification = makeNotification(other, {
    user: OTHER_USER_ID,
    scheduled_for: new Date("2026-09-02T04:00:00.000Z"),
  });

  return {
    recommendations: [active, archived, other],
    notifications: [
      dueSoon,
      due,
      future,
      archivedNotification,
      otherNotification,
    ],
    active,
    archived,
    other,
    dueSoon,
    due,
    future,
    archivedNotification,
    otherNotification,
    previousDelivery,
    previousRead,
  };
};

const comparable = (value) => {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toHexString === "function") {
    return value.toHexString();
  }
  return value;
};

const equalValues = (left, right) =>
  String(comparable(left)) === String(comparable(right));

const matchesCondition = (value, condition) => {
  if (
    condition &&
    typeof condition === "object" &&
    !(condition instanceof Date) &&
    !(typeof condition.toHexString === "function")
  ) {
    if (Object.prototype.hasOwnProperty.call(condition, "$ne")) {
      return !equalValues(value, condition.$ne);
    }
    if (Object.prototype.hasOwnProperty.call(condition, "$in")) {
      return condition.$in.some((candidate) => equalValues(value, candidate));
    }
    if (Object.prototype.hasOwnProperty.call(condition, "$lte")) {
      return new Date(value).getTime() <= new Date(condition.$lte).getTime();
    }
  }

  if (condition === null) return value == null;
  return equalValues(value, condition);
};

const matchesFilter = (document, filter) =>
  Object.entries(filter).every(([field, condition]) =>
    matchesCondition(document[field], condition)
  );

const makeHarness = (fixture = makeFixture(), errors = {}) => {
  const calls = {
    recommendationFind: [],
    recommendationSelect: [],
    notificationFind: [],
    notificationSort: [],
    countDocuments: [],
    updateMany: [],
    findOne: [],
    findOneAndUpdate: [],
  };

  const SavedRecommendationModel = {
    find(filter) {
      calls.recommendationFind.push(filter);
      if (errors.recommendationFind) throw errors.recommendationFind;
      return {
        async select(fields) {
          calls.recommendationSelect.push(fields);
          return fixture.recommendations.filter((recommendation) =>
            matchesFilter(recommendation, filter)
          );
        },
      };
    },
  };

  const NotificationModel = {
    find(filter) {
      calls.notificationFind.push(filter);
      return {
        async sort(sort) {
          calls.notificationSort.push(sort);
          if (errors.notificationFind) throw errors.notificationFind;
          return fixture.notifications
            .filter((notification) => matchesFilter(notification, filter))
            .sort(
              (left, right) =>
                new Date(right.scheduled_for).getTime() -
                new Date(left.scheduled_for).getTime()
            );
        },
      };
    },
    async countDocuments(filter) {
      calls.countDocuments.push(filter);
      if (errors.countDocuments) throw errors.countDocuments;
      return fixture.notifications.filter((notification) =>
        matchesFilter(notification, filter)
      ).length;
    },
    async updateMany(filter, update) {
      calls.updateMany.push({ filter, update });
      if (errors.updateMany) throw errors.updateMany;
      let modifiedCount = 0;
      for (const notification of fixture.notifications) {
        if (matchesFilter(notification, filter)) {
          Object.assign(notification, update.$set);
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    },
    async findOne(filter) {
      calls.findOne.push(filter);
      if (errors.findOne) throw errors.findOne;
      return (
        fixture.notifications.find((notification) =>
          matchesFilter(notification, filter)
        ) || null
      );
    },
    async findOneAndUpdate(filter, update, options) {
      calls.findOneAndUpdate.push({ filter, update, options });
      if (errors.findOneAndUpdate) throw errors.findOneAndUpdate;
      const notification = fixture.notifications.find((candidate) =>
        matchesFilter(candidate, filter)
      );
      if (!notification) return null;
      Object.assign(notification, update.$set);
      return notification;
    },
  };

  const controllers = createNotificationControllers({
    NotificationModel,
    SavedRecommendationModel,
    now: () => new Date(FIXED_NOW),
  });

  return {
    fixture,
    calls,
    NotificationModel,
    SavedRecommendationModel,
    ...controllers,
  };
};

const makeResponse = () => {
  const state = { statusCode: null, body: null };
  return {
    state,
    status(statusCode) {
      state.statusCode = statusCode;
      return this;
    },
    json(body) {
      state.body = body;
      return body;
    },
  };
};

const invoke = async (controller, { id, query, body, userId } = {}) => {
  const req = {
    user: { id: userId || FARMER_ID },
    params: id === undefined ? {} : { id },
    query: query || {},
    body: body || {},
  };
  const res = makeResponse();
  await controller(req, res);
  return res.state;
};

const findRoute = (path, method) =>
  notificationRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method]
  )?.route;

test("notification routes use auth, farmer guard, then exact controller", () => {
  const listRoute = findRoute("/", "get");
  const readRoute = findRoute("/:id/read", "patch");

  assert.deepEqual(
    listRoute.stack.map((layer) => layer.handle),
    [authMiddleware, farmerAuthMiddleware, listNotifications]
  );
  assert.deepEqual(
    readRoute.stack.map((layer) => layer.handle),
    [authMiddleware, farmerAuthMiddleware, markNotificationRead]
  );
});

test("notification list rejects unauthenticated requests", () => {
  const res = makeResponse();
  findRoute("/", "get").stack[0].handle(
    { headers: {} },
    res,
    () => assert.fail("next called")
  );

  assert.equal(res.state.statusCode, 401);
  assert.deepEqual(res.state.body, { error: "No token provided" });
});

test("notification list rejects authenticated non-farmers", async (t) => {
  const originalExists = User.exists;
  t.after(() => {
    User.exists = originalExists;
  });
  User.exists = async () => null;

  const res = makeResponse();
  await findRoute("/", "get").stack[1].handle(
    { user: { id: FARMER_ID } },
    res,
    () => assert.fail("next called")
  );

  assert.equal(res.state.statusCode, 403);
  assert.equal(res.state.body.message, "Farmer access required");
});

test("default list returns only owner due notifications for active recommendations", async () => {
  const harness = makeHarness();
  const historicalCount = harness.fixture.notifications.length;
  const state = await invoke(harness.listNotifications, {
    query: {
      user_id: OTHER_USER_ID,
      now: "2099-01-01T00:00:00.000Z",
    },
  });

  assert.equal(state.statusCode, 200);
  assert.deepEqual(harness.calls.recommendationFind, [
    { user: FARMER_ID, status: { $ne: "ARCHIVED" } },
  ]);
  assert.equal(harness.calls.notificationFind[0].user, FARMER_ID);
  assert.deepEqual(harness.calls.notificationFind[0].recommendation.$in, [
    harness.fixture.active._id,
  ]);
  assert.equal(
    harness.calls.notificationFind[0].scheduled_for.$lte.toISOString(),
    FIXED_NOW.toISOString()
  );
  assert.deepEqual(harness.calls.notificationSort, [{ scheduled_for: -1 }]);
  assert.deepEqual(
    state.body.notifications.map((notification) => notification.id),
    [String(harness.fixture.dueSoon._id), String(harness.fixture.due._id)]
  );
  assert.deepEqual(
    state.body.notifications.map((notification) => notification.type),
    ["RECOMMENDATION_DUE_SOON", "RECOMMENDATION_DUE"]
  );
  assert.equal(state.body.unread_count, 1);
  assert.equal(harness.fixture.notifications.length, historicalCount);
  assert.equal(typeof harness.NotificationModel.create, "undefined");
});

test("exactly scheduled is eligible while future, archived, and cross-user records remain hidden", async () => {
  const harness = makeHarness();
  const state = await invoke(harness.listNotifications);
  const returnedIds = new Set(
    state.body.notifications.map((notification) => notification.id)
  );

  assert.equal(returnedIds.has(String(harness.fixture.dueSoon._id)), true);
  assert.equal(returnedIds.has(String(harness.fixture.future._id)), false);
  assert.equal(
    returnedIds.has(String(harness.fixture.archivedNotification._id)),
    false
  );
  assert.equal(
    returnedIds.has(String(harness.fixture.otherNotification._id)),
    false
  );
});

test("custom reminder is hidden before its time and joins normal bell delivery when due", async () => {
  const harness = makeHarness();
  const before = await invoke(harness.listNotifications);
  assert.equal(
    before.body.notifications.some(
      (notification) => notification.type === "RECOMMENDATION_CUSTOM"
    ),
    false
  );
  assert.equal(harness.fixture.future.delivered_at, null);

  harness.fixture.future.scheduled_for = new Date(FIXED_NOW);
  const due = await invoke(harness.listNotifications);
  const custom = due.body.notifications.find(
    (notification) => notification.type === "RECOMMENDATION_CUSTOM"
  );
  assert.ok(custom);
  assert.equal(due.body.unread_count, 2);
  assert.equal(custom.delivered_at.toISOString(), FIXED_NOW.toISOString());

  const marked = await invoke(harness.markNotificationRead, {
    id: String(harness.fixture.future._id),
  });
  assert.equal(marked.statusCode, 200);
  assert.equal(marked.body.notification.type, "RECOMMENDATION_CUSTOM");
  assert.equal(marked.body.notification.read_at.toISOString(), FIXED_NOW.toISOString());
});

test("inactive automatic reminders never surface or count as unread", async () => {
  const harness = makeHarness();
  harness.fixture.dueSoon.active = false;
  const state = await invoke(harness.listNotifications);

  assert.deepEqual(
    state.body.notifications.map((notification) => notification.id),
    [String(harness.fixture.due._id)]
  );
  assert.equal(state.body.unread_count, 0);
  assert.equal(harness.fixture.dueSoon.delivered_at, null);
});

test("unread=true filters returned items while unread count uses all eligible unread items", async () => {
  const harness = makeHarness();
  const state = await invoke(harness.listNotifications, {
    query: { unread: "true" },
  });

  assert.equal(state.statusCode, 200);
  assert.equal(harness.calls.notificationFind[0].read_at, null);
  assert.equal(state.body.notifications.length, 1);
  assert.equal(state.body.notifications[0].id, String(harness.fixture.dueSoon._id));
  assert.equal(state.body.unread_count, 1);
  assert.equal(harness.calls.countDocuments[0].read_at, null);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      harness.calls.countDocuments[0],
      "scheduled_for"
    ),
    true
  );
});

test("only literal unread=true activates unread filtering", async () => {
  const harness = makeHarness();
  const state = await invoke(harness.listNotifications, {
    query: { unread: "TRUE" },
  });

  assert.equal(state.body.notifications.length, 2);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      harness.calls.notificationFind[0],
      "read_at"
    ),
    false
  );
});

test("list response exposes only safe notification and recommendation summary fields", async () => {
  const harness = makeHarness();
  const state = await invoke(harness.listNotifications);
  const notification = state.body.notifications[0];

  assert.deepEqual(Object.keys(notification).sort(), [
    "created_at",
    "delivered_at",
    "id",
    "is_read",
    "message",
    "read_at",
    "recommendation",
    "recommendation_id",
    "scheduled_for",
    "title",
    "type",
  ]);
  assert.deepEqual(Object.keys(notification.recommendation).sort(), [
    "crop",
    "farmer_district",
    "prediction_target_date",
    "recommended_market",
  ]);
  assert.equal(notification.user, undefined);
  assert.equal(notification.__v, undefined);
  assert.equal(notification.recommendation.recommendation_fingerprint, undefined);
  assert.equal(notification.recommendation.recommendation_snapshot, undefined);
  assert.doesNotMatch(
    `${notification.title} ${notification.message}`,
    /SELL_NOW|\bWAIT\b|\bHOLD\b/i
  );
});

test("first eligible exposure stamps delivered_at once without changing read_at", async () => {
  const harness = makeHarness();
  const originalRead = harness.fixture.dueSoon.read_at;
  const originalExistingDelivery = harness.fixture.due.delivered_at;
  const state = await invoke(harness.listNotifications);

  assert.equal(harness.calls.updateMany.length, 1);
  assert.deepEqual(harness.calls.updateMany[0].filter._id.$in, [
    harness.fixture.dueSoon._id,
  ]);
  assert.equal(
    harness.fixture.dueSoon.delivered_at.toISOString(),
    FIXED_NOW.toISOString()
  );
  assert.equal(harness.fixture.dueSoon.read_at, originalRead);
  assert.equal(harness.fixture.due.delivered_at, originalExistingDelivery);
  assert.equal(
    state.body.notifications[0].delivered_at.toISOString(),
    FIXED_NOW.toISOString()
  );
});

test("future and archived notifications are not stamped delivered", async () => {
  const harness = makeHarness();
  await invoke(harness.listNotifications);

  assert.equal(harness.fixture.future.delivered_at, null);
  assert.equal(harness.fixture.archivedNotification.delivered_at, null);
  assert.equal(
    harness.calls.updateMany[0].filter.recommendation.$in.some((id) =>
      equalValues(id, harness.fixture.archived._id)
    ),
    false
  );
});

test("owner can mark a due notification read using server ownership and time", async () => {
  const harness = makeHarness();
  const state = await invoke(harness.markNotificationRead, {
    id: String(harness.fixture.dueSoon._id),
    query: { user_id: OTHER_USER_ID },
    body: { user_id: OTHER_USER_ID },
  });

  assert.equal(state.statusCode, 200);
  assert.equal(harness.calls.findOne[0]._id, String(harness.fixture.dueSoon._id));
  assert.equal(harness.calls.findOne[0].user, FARMER_ID);
  assert.deepEqual(harness.calls.findOne[0].recommendation.$in, [
    harness.fixture.active._id,
  ]);
  assert.equal(
    harness.calls.findOne[0].scheduled_for.$lte.toISOString(),
    FIXED_NOW.toISOString()
  );
  assert.equal(
    state.body.notification.read_at.toISOString(),
    FIXED_NOW.toISOString()
  );
  assert.equal(
    state.body.notification.delivered_at.toISOString(),
    FIXED_NOW.toISOString()
  );
  assert.deepEqual(Object.keys(state.body.notification).sort(), [
    "delivered_at",
    "id",
    "read_at",
    "recommendation_id",
    "type",
  ]);
});

test("mark-read preserves an existing delivered timestamp", async () => {
  const harness = makeHarness();
  harness.fixture.dueSoon.delivered_at = harness.fixture.previousDelivery;
  const state = await invoke(harness.markNotificationRead, {
    id: String(harness.fixture.dueSoon._id),
  });

  assert.equal(state.statusCode, 200);
  assert.equal(
    state.body.notification.delivered_at,
    harness.fixture.previousDelivery
  );
  assert.deepEqual(harness.calls.findOneAndUpdate[0].update.$set, {
    read_at: FIXED_NOW,
  });
});

test("mark-read is idempotent and preserves the first read timestamp", async () => {
  const harness = makeHarness();
  const id = String(harness.fixture.dueSoon._id);

  const first = await invoke(harness.markNotificationRead, { id });
  const firstReadAt = first.body.notification.read_at;
  const firstDeliveredAt = first.body.notification.delivered_at;
  const second = await invoke(harness.markNotificationRead, { id });

  assert.equal(second.statusCode, 200);
  assert.equal(second.body.notification.read_at, firstReadAt);
  assert.equal(second.body.notification.delivered_at, firstDeliveredAt);
  assert.equal(harness.calls.findOneAndUpdate.length, 1);
});

test("already-read notifications keep their original timestamp", async () => {
  const harness = makeHarness();
  const state = await invoke(harness.markNotificationRead, {
    id: String(harness.fixture.due._id),
  });

  assert.equal(state.statusCode, 200);
  assert.equal(state.body.notification.read_at, harness.fixture.previousRead);
  assert.equal(
    state.body.notification.delivered_at,
    harness.fixture.previousDelivery
  );
  assert.equal(harness.calls.findOneAndUpdate.length, 0);
});

test("malformed, missing, cross-user, archived, and future mark-read attempts return the same 404", async (t) => {
  const cases = [
    ["malformed", "not-an-object-id", true],
    ["missing", new mongoose.Types.ObjectId().toString(), false],
    ["cross-user", null, false, "otherNotification"],
    ["archived", null, false, "archivedNotification"],
    ["future", null, false, "future"],
  ];

  for (const [name, providedId, malformed, fixtureKey] of cases) {
    await t.test(name, async () => {
      const harness = makeHarness();
      const id = providedId || String(harness.fixture[fixtureKey]._id);
      const state = await invoke(harness.markNotificationRead, { id });

      assert.equal(state.statusCode, 404);
      assert.deepEqual(state.body, {
        success: false,
        message: "Notification not found",
      });
      assert.equal(harness.calls.findOneAndUpdate.length, 0);
      if (malformed) {
        assert.equal(harness.calls.recommendationFind.length, 0);
        assert.equal(harness.calls.findOne.length, 0);
      }
    });
  }
});

test("empty active recommendation set returns no notifications without touching historical records", async () => {
  const fixture = makeFixture();
  fixture.recommendations = fixture.recommendations.map((recommendation) => ({
    ...recommendation,
    status: recommendation.user === FARMER_ID ? "ARCHIVED" : recommendation.status,
  }));
  const historicalCount = fixture.notifications.length;
  const harness = makeHarness(fixture);
  const state = await invoke(harness.listNotifications);

  assert.deepEqual(state.body, {
    success: true,
    unread_count: 0,
    notifications: [],
  });
  assert.equal(harness.calls.notificationFind.length, 0);
  assert.equal(harness.calls.updateMany.length, 0);
  assert.equal(fixture.notifications.length, historicalCount);
});

test("notification persistence failures return controlled errors", async (t) => {
  await t.test("list failure", async () => {
    const harness = makeHarness(makeFixture(), {
      notificationFind: new Error("secret list failure"),
    });
    const state = await invoke(harness.listNotifications);
    assert.equal(state.statusCode, 500);
    assert.deepEqual(state.body, {
      success: false,
      message: "Unable to list notifications",
    });
    assert.doesNotMatch(JSON.stringify(state.body), /secret/i);
  });

  await t.test("mark-read failure", async () => {
    const harness = makeHarness(makeFixture(), {
      findOne: new Error("secret read failure"),
    });
    const state = await invoke(harness.markNotificationRead, {
      id: String(harness.fixture.dueSoon._id),
    });
    assert.equal(state.statusCode, 500);
    assert.deepEqual(state.body, {
      success: false,
      message: "Unable to mark notification as read",
    });
    assert.doesNotMatch(JSON.stringify(state.body), /secret/i);
  });
});
