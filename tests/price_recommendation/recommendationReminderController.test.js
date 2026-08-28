const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../src/models/User");
const authMiddleware = require("../../src/middlewares/authMiddleware");
const farmerAuthMiddleware = require(
  "../../src/middlewares/farmerAuthMiddleware"
);
const {
  getRecommendationReminder,
  scheduleRecommendationReminder,
  cancelRecommendationReminder,
  createRecommendationReminderControllers,
} = require("../../src/controllers/savedRecommendationController");
const marketRecommendationRoutes = require(
  "../../src/routes/marketRecommendationRoutes"
);

const FIXED_NOW = new Date("2026-08-28T04:30:00.000Z");
const FARMER_ID = new mongoose.Types.ObjectId().toString();
const OTHER_USER_ID = new mongoose.Types.ObjectId().toString();

const makeRecommendation = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  user: FARMER_ID,
  crop: "beans",
  recommended_market: "Kandy",
  status: "ACTIVE",
  ...overrides,
});

const comparable = (value) =>
  value && typeof value.toHexString === "function"
    ? value.toHexString()
    : value instanceof Date
      ? value.getTime()
      : value;

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
  }
  return equalValues(value, condition);
};

const matchesFilter = (document, filter) =>
  Object.entries(filter).every(([field, condition]) =>
    matchesCondition(document[field], condition)
  );

const makeHarness = (overrides = {}) => {
  const recommendation =
    overrides.recommendation === undefined
      ? makeRecommendation()
      : overrides.recommendation;
  const automatic = [
    {
      _id: new mongoose.Types.ObjectId(),
      user: FARMER_ID,
      recommendation: recommendation?._id,
      type: "RECOMMENDATION_DUE_SOON",
      active: true,
      delivered_at: null,
      read_at: null,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      user: FARMER_ID,
      recommendation: recommendation?._id,
      type: "RECOMMENDATION_DUE",
      active: true,
      delivered_at: new Date("2026-08-27T04:30:00.000Z"),
      read_at: new Date("2026-08-27T05:00:00.000Z"),
    },
  ];
  const notifications = [...automatic, ...(overrides.notifications || [])];
  const calls = {
    recommendationFindOne: [],
    notificationFindOne: [],
    notificationUpdateMany: [],
    notificationFindOneAndUpdate: [],
  };

  const SavedRecommendationModel = {
    async findOne(filter) {
      calls.recommendationFindOne.push(filter);
      if (overrides.recommendationError) throw overrides.recommendationError;
      return recommendation && matchesFilter(recommendation, filter)
        ? recommendation
        : null;
    },
  };

  const NotificationModel = {
    async findOne(filter) {
      calls.notificationFindOne.push(filter);
      if (overrides.notificationFindError) {
        throw overrides.notificationFindError;
      }
      return notifications.find((item) => matchesFilter(item, filter)) || null;
    },
    async updateMany(filter, update) {
      calls.notificationUpdateMany.push({ filter, update });
      if (overrides.updateManyError) throw overrides.updateManyError;
      let modifiedCount = 0;
      for (const item of notifications) {
        if (matchesFilter(item, filter)) {
          Object.assign(item, update.$set);
          modifiedCount += 1;
        }
      }
      return { modifiedCount };
    },
    async findOneAndUpdate(filter, update, options) {
      calls.notificationFindOneAndUpdate.push({ filter, update, options });
      if (overrides.findOneAndUpdateError) {
        throw overrides.findOneAndUpdateError;
      }
      let item = notifications.find((candidate) =>
        matchesFilter(candidate, filter)
      );
      if (!item && options?.upsert) {
        item = {
          _id: new mongoose.Types.ObjectId(),
          ...update.$setOnInsert,
        };
        notifications.push(item);
      }
      if (!item) return null;
      Object.assign(item, update.$set);
      return item;
    },
  };

  return {
    recommendation,
    automatic,
    notifications,
    calls,
    ...createRecommendationReminderControllers({
      SavedRecommendationModel,
      NotificationModel,
      now: () => new Date(FIXED_NOW),
    }),
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

const invoke = async (
  controller,
  { id, body = {}, userId = FARMER_ID } = {}
) => {
  const res = makeResponse();
  await controller(
    {
      user: { id: userId },
      params: { id: id ?? new mongoose.Types.ObjectId().toString() },
      body,
    },
    res
  );
  return res.state;
};

const findRoute = (path, method) =>
  marketRecommendationRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method]
  )?.route;

test("custom reminder routes use auth, farmer guard, and exact controllers", () => {
  for (const [method, controller] of [
    ["get", getRecommendationReminder],
    ["put", scheduleRecommendationReminder],
    ["delete", cancelRecommendationReminder],
  ]) {
    const route = findRoute("/recommend-market/saved/:id/reminder", method);
    assert.ok(route);
    assert.deepEqual(
      route.stack.map((layer) => layer.handle),
      [authMiddleware, farmerAuthMiddleware, controller]
    );
  }
});

test("custom reminder routes reject unauthenticated requests", () => {
  for (const method of ["get", "put", "delete"]) {
    const res = makeResponse();
    findRoute("/recommend-market/saved/:id/reminder", method).stack[0].handle(
      { headers: {} },
      res,
      () => assert.fail("next called")
    );
    assert.equal(res.state.statusCode, 401);
  }
});

test("custom reminder routes reject authenticated non-farmers", async (t) => {
  const originalExists = User.exists;
  t.after(() => {
    User.exists = originalExists;
  });
  User.exists = async () => null;

  for (const method of ["get", "put", "delete"]) {
    const res = makeResponse();
    await findRoute(
      "/recommend-market/saved/:id/reminder",
      method
    ).stack[1].handle(
      { user: { id: FARMER_ID } },
      res,
      () => assert.fail("next called")
    );
    assert.equal(res.state.statusCode, 403);
  }
});

test("farmer schedules a future custom reminder with server-controlled fields", async () => {
  const harness = makeHarness();
  const scheduledFor = "2026-08-30T09:15:00.000Z";
  const state = await invoke(harness.scheduleRecommendationReminder, {
    id: String(harness.recommendation._id),
    body: { scheduled_for: scheduledFor },
  });

  assert.equal(state.statusCode, 200);
  assert.equal(state.body.reminder.type, "RECOMMENDATION_CUSTOM");
  assert.equal(state.body.reminder.scheduled_for.toISOString(), scheduledFor);
  const custom = harness.notifications.find(
    (item) => item.type === "RECOMMENDATION_CUSTOM"
  );
  assert.ok(custom);
  assert.equal(custom.user, FARMER_ID);
  assert.equal(String(custom.recommendation), String(harness.recommendation._id));
  assert.equal(custom.read_at, null);
  assert.equal(custom.delivered_at, null);
  assert.equal(custom.active, true);
  assert.equal(custom.title, "Recommendation reminder");
  assert.equal(custom.message, "Review your saved Beans recommendation for Kandy.");
  assert.doesNotMatch(`${custom.title} ${custom.message}`, /SELL NOW|\bWAIT\b/i);
});

test("scheduling suppresses automatic reminders without erasing delivered history", async () => {
  const harness = makeHarness();
  const deliveredAt = harness.automatic[1].delivered_at;
  const readAt = harness.automatic[1].read_at;
  await invoke(harness.scheduleRecommendationReminder, {
    id: String(harness.recommendation._id),
    body: { scheduled_for: "2026-08-30T09:15:00.000Z" },
  });

  assert.equal(harness.calls.notificationUpdateMany.length, 1);
  assert.deepEqual(harness.calls.notificationUpdateMany[0].filter, {
    user: FARMER_ID,
    recommendation: harness.recommendation._id,
    type: {
      $in: ["RECOMMENDATION_DUE_SOON", "RECOMMENDATION_DUE"],
    },
    active: { $ne: false },
  });
  assert.equal(harness.automatic.every((item) => item.active === false), true);
  assert.equal(harness.automatic[1].delivered_at, deliveredAt);
  assert.equal(harness.automatic[1].read_at, readAt);
});

test("rescheduling updates the same custom row and resets delivery and read state", async () => {
  const customId = new mongoose.Types.ObjectId();
  const custom = {
    _id: customId,
    user: FARMER_ID,
    recommendation: null,
    type: "RECOMMENDATION_CUSTOM",
    scheduled_for: new Date("2026-08-29T04:30:00.000Z"),
    delivered_at: new Date("2026-08-28T03:30:00.000Z"),
    read_at: new Date("2026-08-28T04:00:00.000Z"),
    active: true,
  };
  const recommendation = makeRecommendation();
  custom.recommendation = recommendation._id;
  const harness = makeHarness({ recommendation, notifications: [custom] });

  for (const scheduledFor of [
    "2026-08-30T09:15:00.000Z",
    "2026-09-01T12:00:00.000Z",
  ]) {
    const state = await invoke(harness.scheduleRecommendationReminder, {
      id: String(recommendation._id),
      body: { scheduled_for: scheduledFor },
    });
    assert.equal(state.body.reminder.id, String(customId));
    assert.equal(custom.scheduled_for.toISOString(), scheduledFor);
  }

  assert.equal(
    harness.notifications.filter(
      (item) => item.type === "RECOMMENDATION_CUSTOM"
    ).length,
    1
  );
  assert.equal(custom.read_at, null);
  assert.equal(custom.delivered_at, null);
  assert.equal(custom.active, true);
});

test("GET returns the active custom reminder or null", async () => {
  const recommendation = makeRecommendation();
  const custom = {
    _id: new mongoose.Types.ObjectId(),
    user: FARMER_ID,
    recommendation: recommendation._id,
    type: "RECOMMENDATION_CUSTOM",
    scheduled_for: new Date("2026-08-30T09:15:00.000Z"),
    active: true,
  };
  const withReminder = makeHarness({ recommendation, notifications: [custom] });
  const found = await invoke(withReminder.getRecommendationReminder, {
    id: String(recommendation._id),
  });
  assert.deepEqual(found.body.reminder, {
    id: String(custom._id),
    type: "RECOMMENDATION_CUSTOM",
    scheduled_for: custom.scheduled_for,
  });

  custom.active = false;
  const missing = await invoke(withReminder.getRecommendationReminder, {
    id: String(recommendation._id),
  });
  assert.equal(missing.body.reminder, null);
});

test("cancel is idempotent, keeps the recommendation, and does not reactivate automatic reminders", async () => {
  const recommendation = makeRecommendation();
  const custom = {
    _id: new mongoose.Types.ObjectId(),
    user: FARMER_ID,
    recommendation: recommendation._id,
    type: "RECOMMENDATION_CUSTOM",
    scheduled_for: new Date("2026-08-30T09:15:00.000Z"),
    active: true,
  };
  const harness = makeHarness({ recommendation, notifications: [custom] });
  harness.automatic.forEach((item) => {
    item.active = false;
  });

  const first = await invoke(harness.cancelRecommendationReminder, {
    id: String(recommendation._id),
  });
  const second = await invoke(harness.cancelRecommendationReminder, {
    id: String(recommendation._id),
  });

  assert.deepEqual(first.body, { success: true, reminder: null });
  assert.deepEqual(second.body, { success: true, reminder: null });
  assert.equal(custom.active, false);
  assert.equal(harness.automatic.every((item) => item.active === false), true);
  assert.equal(harness.recommendation, recommendation);
});

test("date validation rejects missing, invalid, past, and exact-now values", async (t) => {
  const cases = [
    ["missing", {}],
    ["invalid", { scheduled_for: "later" }],
    ["date-only", { scheduled_for: "2026-08-30" }],
    ["missing timezone", { scheduled_for: "2026-08-30T09:15:00" }],
    ["impossible date", { scheduled_for: "2026-02-31T09:15:00.000Z" }],
    ["past", { scheduled_for: "2026-08-28T04:29:59.999Z" }],
    ["exact now", { scheduled_for: FIXED_NOW.toISOString() }],
  ];

  for (const [name, body] of cases) {
    await t.test(name, async () => {
      const harness = makeHarness();
      const state = await invoke(harness.scheduleRecommendationReminder, {
        id: String(harness.recommendation._id),
        body,
      });
      assert.equal(state.statusCode, 400);
      assert.equal(harness.calls.notificationUpdateMany.length, 0);
      assert.equal(harness.calls.notificationFindOneAndUpdate.length, 0);
    });
  }
});

test("server-controlled and unrelated reminder fields are rejected", async () => {
  for (const field of [
    "user",
    "recommendation",
    "type",
    "read",
    "read_at",
    "delivered_at",
  ]) {
    const harness = makeHarness();
    const state = await invoke(harness.scheduleRecommendationReminder, {
      id: String(harness.recommendation._id),
      body: {
        scheduled_for: "2026-08-30T09:15:00.000Z",
        [field]: "forged",
      },
    });
    assert.equal(state.statusCode, 400);
  }
});

test("malformed, missing, cross-user, and archived recommendations share generic 404 behavior", async (t) => {
  await t.test("malformed", async () => {
    const harness = makeHarness();
    const state = await invoke(harness.scheduleRecommendationReminder, {
      id: "not-an-object-id",
      body: { scheduled_for: "2026-08-30T09:15:00.000Z" },
    });
    assert.equal(state.statusCode, 404);
    assert.equal(harness.calls.recommendationFindOne.length, 0);
  });

  for (const [name, recommendation] of [
    ["missing", null],
    ["cross-user", makeRecommendation({ user: OTHER_USER_ID })],
    ["archived", makeRecommendation({ status: "ARCHIVED" })],
  ]) {
    await t.test(name, async () => {
      const harness = makeHarness({ recommendation });
      const id = recommendation?._id || new mongoose.Types.ObjectId();
      for (const controller of [
        harness.getRecommendationReminder,
        harness.scheduleRecommendationReminder,
        harness.cancelRecommendationReminder,
      ]) {
        const state = await invoke(controller, {
          id: String(id),
          body: { scheduled_for: "2026-08-30T09:15:00.000Z" },
        });
        assert.equal(state.statusCode, 404);
        assert.deepEqual(state.body, {
          success: false,
          message: "Saved recommendation not found",
        });
      }
    });
  }
});

test("reminder persistence failures return controlled messages", async () => {
  const recommendation = makeRecommendation();
  const harness = makeHarness({
    recommendation,
    findOneAndUpdateError: new Error("secret database failure"),
  });
  const state = await invoke(harness.scheduleRecommendationReminder, {
    id: String(recommendation._id),
    body: { scheduled_for: "2026-08-30T09:15:00.000Z" },
  });

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, {
    success: false,
    message: "Unable to schedule recommendation reminder",
  });
  assert.doesNotMatch(JSON.stringify(state.body), /secret/i);
});
