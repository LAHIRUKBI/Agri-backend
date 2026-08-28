const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../src/models/User");
const authMiddleware = require("../../src/middlewares/authMiddleware");
const farmerAuthMiddleware = require(
  "../../src/middlewares/farmerAuthMiddleware"
);
const {
  recommendBestMarket,
} = require("../../src/controllers/marketRecommendationController");
const {
  saveRecommendation,
  listSavedRecommendations,
  getSavedRecommendation,
  archiveSavedRecommendation,
  createSavedRecommendationReadControllers,
} = require("../../src/controllers/savedRecommendationController");
const {
  getEffectiveRecommendationStatus,
} = require("../../src/utils/recommendationLifecycle");
const marketRecommendationRoutes = require(
  "../../src/routes/marketRecommendationRoutes"
);

const FIXED_NOW = new Date("2026-08-26T04:30:00.000Z");
const FARMER_ID = new mongoose.Types.ObjectId().toString();
const OTHER_USER_ID = new mongoose.Types.ObjectId().toString();

const makeRecommendation = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  user: FARMER_ID,
  crop: "beans",
  farmer_district: "kandy",
  recommended_market: "kandy",
  current_price: 200,
  current_price_source: "manual",
  experimental_price: 215,
  persistence_baseline: 200,
  quantity_kg: 100,
  market_outlook_status: "UPWARD",
  market_outlook_strength: "MODERATE",
  action_decision: "UNCERTAIN",
  action_authorized: false,
  model_version: "run_013",
  policy_version: "persistence_primary_v1",
  prediction_target_date: new Date("2026-08-28T04:30:00.000Z"),
  status: "ACTIVE",
  recommendation_fingerprint: "must-not-be-returned",
  recommendation_snapshot: {
    crop: "beans",
    ai_insights: { recommendation: "Historical advice" },
  },
  createdAt: new Date("2026-08-26T04:30:00.000Z"),
  updatedAt: new Date("2026-08-26T04:30:00.000Z"),
  __v: 0,
  ...overrides,
});

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

const makeModelHarness = (overrides = {}) => {
  const calls = {
    find: [],
    sort: [],
    findOne: [],
    findOneAndUpdate: [],
    notificationFind: [],
    notificationFindOne: [],
  };

  const model = {
    find(query) {
      calls.find.push(query);
      if (overrides.findSynchronousError) {
        throw overrides.findSynchronousError;
      }
      return {
        async sort(sort) {
          calls.sort.push(sort);
          if (overrides.listError) throw overrides.listError;
          return overrides.listResults || [];
        },
      };
    },
    async findOne(query) {
      calls.findOne.push(query);
      if (overrides.findOneError) throw overrides.findOneError;
      return overrides.findOneResult || null;
    },
    async findOneAndUpdate(query, update, options) {
      calls.findOneAndUpdate.push({ query, update, options });
      if (overrides.archiveError) throw overrides.archiveError;
      if (Array.isArray(overrides.archiveResults)) {
        return overrides.archiveResults.shift() || null;
      }
      return overrides.archiveResult || null;
    },
  };

  const notificationModel = {
    async find(query) {
      calls.notificationFind.push(query);
      if (overrides.notificationFindError) {
        throw overrides.notificationFindError;
      }
      return overrides.reminderResults || [];
    },
    async findOne(query) {
      calls.notificationFindOne.push(query);
      if (overrides.notificationFindOneError) {
        throw overrides.notificationFindOneError;
      }
      return overrides.reminderResult || null;
    },
  };

  const controllers = createSavedRecommendationReadControllers({
    SavedRecommendationModel: model,
    NotificationModel: notificationModel,
    now: () => new Date(FIXED_NOW),
  });

  return { calls, model, ...controllers };
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
  marketRecommendationRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method]
  )?.route;

test("Stage 3C routes use auth, farmer guard, and their exact controllers", () => {
  const cases = [
    ["get", "/recommend-market/saved", listSavedRecommendations],
    ["get", "/recommend-market/saved/:id", getSavedRecommendation],
    ["delete", "/recommend-market/saved/:id", archiveSavedRecommendation],
  ];

  for (const [method, path, controller] of cases) {
    const route = findRoute(path, method);
    assert.ok(route);
    assert.deepEqual(
      route.stack.map((layer) => layer.handle),
      [authMiddleware, farmerAuthMiddleware, controller]
    );
  }

  assert.deepEqual(
    findRoute("/recommend-market/saved", "post").stack.map(
      (layer) => layer.handle
    ),
    [authMiddleware, farmerAuthMiddleware, saveRecommendation]
  );
  assert.deepEqual(
    findRoute("/recommend-market", "post").stack.map((layer) => layer.handle),
    [recommendBestMarket]
  );
});

test("list route rejects unauthenticated requests through auth middleware", () => {
  const authLayer = findRoute("/recommend-market/saved", "get").stack[0];
  const res = makeResponse();

  authLayer.handle({ headers: {} }, res, () => assert.fail("next called"));

  assert.equal(res.state.statusCode, 401);
  assert.deepEqual(res.state.body, { error: "No token provided" });
});

test("list route rejects authenticated non-farmers", async (t) => {
  const originalExists = User.exists;
  t.after(() => {
    User.exists = originalExists;
  });
  User.exists = async () => null;

  const farmerLayer = findRoute("/recommend-market/saved", "get").stack[1];
  const res = makeResponse();
  await farmerLayer.handle(
    { user: { id: FARMER_ID } },
    res,
    () => assert.fail("next called")
  );

  assert.equal(res.state.statusCode, 403);
  assert.equal(res.state.body.message, "Farmer access required");
});

test("effective lifecycle boundaries are deterministic", () => {
  const cases = [
    ["2026-08-27T04:30:00.001Z", "ACTIVE"],
    ["2026-08-27T04:30:00.000Z", "DUE_SOON"],
    ["2026-08-27T03:30:00.000Z", "DUE_SOON"],
    ["2026-08-26T04:30:00.000Z", "DUE"],
    ["2026-08-25T04:30:00.000Z", "DUE"],
  ];

  for (const [target, expected] of cases) {
    assert.equal(
      getEffectiveRecommendationStatus({
        storedStatus: "ACTIVE",
        predictionTargetDate: target,
        now: FIXED_NOW,
      }),
      expected
    );
  }
});

test("stored ARCHIVED status remains authoritative regardless of target date", () => {
  assert.equal(
    getEffectiveRecommendationStatus({
      storedStatus: "ARCHIVED",
      predictionTargetDate: "not-a-date",
      now: FIXED_NOW,
    }),
    "ARCHIVED"
  );
});

test("lifecycle helper does not mutate dates and rejects invalid active dates", () => {
  const target = new Date("2026-08-28T04:30:00.000Z");
  const now = new Date(FIXED_NOW);
  const targetTime = target.getTime();
  const nowTime = now.getTime();

  getEffectiveRecommendationStatus({
    storedStatus: "ACTIVE",
    predictionTargetDate: target,
    now,
  });
  assert.equal(target.getTime(), targetTime);
  assert.equal(now.getTime(), nowTime);
  assert.throws(
    () =>
      getEffectiveRecommendationStatus({
        storedStatus: "ACTIVE",
        predictionTargetDate: "not-a-date",
        now,
      }),
    /predictionTargetDate must be a valid date/
  );
});

test("list filters by authenticated owner, excludes archived, sorts newest first, and ignores forged ownership selectors", async () => {
  const newer = makeRecommendation();
  const older = makeRecommendation({
    _id: new mongoose.Types.ObjectId(),
    createdAt: new Date("2026-08-25T04:30:00.000Z"),
  });
  const harness = makeModelHarness({ listResults: [newer, older] });
  const state = await invoke(harness.listSavedRecommendations, {
    query: { user_id: OTHER_USER_ID },
    body: { user_id: OTHER_USER_ID },
  });

  assert.equal(state.statusCode, 200);
  assert.deepEqual(harness.calls.find, [
    { user: FARMER_ID, status: { $ne: "ARCHIVED" } },
  ]);
  assert.deepEqual(harness.calls.sort, [{ createdAt: -1 }]);
  assert.deepEqual(
    state.body.saved_recommendations.map((item) => item.id),
    [String(newer._id), String(older._id)]
  );
});

test("list exposes summary fields only and derives all active lifecycle states", async () => {
  const active = makeRecommendation({
    prediction_target_date: new Date("2026-08-28T04:30:00.000Z"),
  });
  const dueSoon = makeRecommendation({
    prediction_target_date: new Date("2026-08-27T04:30:00.000Z"),
  });
  const due = makeRecommendation({
    prediction_target_date: new Date("2026-08-26T04:30:00.000Z"),
  });
  const harness = makeModelHarness({ listResults: [active, dueSoon, due] });
  const state = await invoke(harness.listSavedRecommendations);

  assert.equal(state.statusCode, 200);
  assert.deepEqual(
    state.body.saved_recommendations.map((item) => item.status),
    ["ACTIVE", "DUE_SOON", "DUE"]
  );
  const expectedFields = [
    "created_at",
    "crop",
    "current_price",
    "experimental_price",
    "farmer_district",
    "id",
    "market_outlook_status",
    "market_outlook_strength",
    "prediction_target_date",
    "quantity_kg",
    "recommended_market",
    "reminder",
    "status",
  ].sort();
  assert.deepEqual(Object.keys(state.body.saved_recommendations[0]).sort(), expectedFields);
  assert.equal(state.body.saved_recommendations[0].recommendation_fingerprint, undefined);
  assert.equal(state.body.saved_recommendations[0].recommendation_snapshot, undefined);
  assert.equal(state.body.saved_recommendations[0].user, undefined);
  assert.equal(state.body.saved_recommendations[0].__v, undefined);
  assert.equal(state.body.saved_recommendations[0].reminder, null);
});

test("list enriches custom reminders with one batched notification query", async () => {
  const first = makeRecommendation();
  const second = makeRecommendation({ _id: new mongoose.Types.ObjectId() });
  const reminder = {
    _id: new mongoose.Types.ObjectId(),
    recommendation: first._id,
    type: "RECOMMENDATION_CUSTOM",
    scheduled_for: new Date("2026-08-30T04:30:00.000Z"),
  };
  const harness = makeModelHarness({
    listResults: [first, second],
    reminderResults: [reminder],
  });
  const state = await invoke(harness.listSavedRecommendations);

  assert.equal(harness.calls.notificationFind.length, 1);
  assert.deepEqual(harness.calls.notificationFind[0], {
    user: FARMER_ID,
    recommendation: { $in: [first._id, second._id] },
    type: "RECOMMENDATION_CUSTOM",
    active: { $ne: false },
  });
  assert.deepEqual(state.body.saved_recommendations[0].reminder, {
    id: String(reminder._id),
    type: "RECOMMENDATION_CUSTOM",
    scheduled_for: reminder.scheduled_for,
  });
  assert.equal(state.body.saved_recommendations[1].reminder, null);
});

test("owner can read an unchanged stored snapshot through an owner-scoped lookup", async () => {
  const record = makeRecommendation();
  const harness = makeModelHarness({ findOneResult: record });
  const state = await invoke(harness.getSavedRecommendation, {
    id: String(record._id),
    query: { user_id: OTHER_USER_ID },
    body: { user_id: OTHER_USER_ID },
  });

  assert.equal(state.statusCode, 200);
  assert.deepEqual(harness.calls.findOne, [
    { _id: String(record._id), user: FARMER_ID },
  ]);
  assert.deepEqual(
    state.body.saved_recommendation.recommendation_snapshot,
    record.recommendation_snapshot
  );
  assert.equal(state.body.saved_recommendation.recommendation_fingerprint, undefined);
  assert.equal(state.body.saved_recommendation.user, undefined);
  assert.equal(state.body.saved_recommendation.__v, undefined);
  assert.equal(state.body.saved_recommendation.status, "ACTIVE");
  assert.equal(state.body.saved_recommendation.reminder, null);
});

test("archived owned record remains readable with ARCHIVED effective status", async () => {
  const record = makeRecommendation({
    status: "ARCHIVED",
    prediction_target_date: new Date("2026-08-20T04:30:00.000Z"),
  });
  const harness = makeModelHarness({ findOneResult: record });
  const state = await invoke(harness.getSavedRecommendation, {
    id: String(record._id),
  });

  assert.equal(state.statusCode, 200);
  assert.equal(state.body.saved_recommendation.status, "ARCHIVED");
  assert.deepEqual(
    state.body.saved_recommendation.recommendation_snapshot,
    record.recommendation_snapshot
  );
});

test("malformed, missing, and cross-user detail lookups share generic 404 behavior", async (t) => {
  await t.test("malformed id", async () => {
    const harness = makeModelHarness();
    const state = await invoke(harness.getSavedRecommendation, {
      id: "not-an-object-id",
    });
    assert.equal(state.statusCode, 404);
    assert.equal(harness.calls.findOne.length, 0);
    assert.equal(state.body.message, "Saved recommendation not found");
  });

  for (const name of ["missing record", "cross-user record"]) {
    await t.test(name, async () => {
      const harness = makeModelHarness({ findOneResult: null });
      const id = new mongoose.Types.ObjectId().toString();
      const state = await invoke(harness.getSavedRecommendation, { id });
      assert.equal(state.statusCode, 404);
      assert.deepEqual(harness.calls.findOne, [{ _id: id, user: FARMER_ID }]);
      assert.deepEqual(state.body, {
        success: false,
        message: "Saved recommendation not found",
      });
    });
  }
});

test("owner archives by scoped update without deleting the document, snapshot, or notifications", async () => {
  const snapshot = { crop: "beans", evidence: "historical" };
  const record = makeRecommendation({
    status: "ARCHIVED",
    recommendation_snapshot: snapshot,
  });
  const harness = makeModelHarness({ archiveResult: record });
  const state = await invoke(harness.archiveSavedRecommendation, {
    id: String(record._id),
    query: { user_id: OTHER_USER_ID },
    body: { user_id: OTHER_USER_ID },
  });

  assert.equal(state.statusCode, 200);
  assert.deepEqual(harness.calls.findOneAndUpdate, [
    {
      query: { _id: String(record._id), user: FARMER_ID },
      update: { $set: { status: "ARCHIVED" } },
      options: { new: true },
    },
  ]);
  assert.equal(record.recommendation_snapshot, snapshot);
  assert.deepEqual(state.body, {
    success: true,
    message: "Recommendation archived",
    saved_recommendation: {
      id: String(record._id),
      status: "ARCHIVED",
    },
  });
  assert.equal(typeof harness.model.deleteOne, "undefined");
  assert.equal(typeof harness.model.findByIdAndDelete, "undefined");
});

test("archive is idempotent for an already archived owned record", async () => {
  const record = makeRecommendation({ status: "ARCHIVED" });
  const harness = makeModelHarness({ archiveResults: [record, record] });

  const first = await invoke(harness.archiveSavedRecommendation, {
    id: String(record._id),
  });
  const second = await invoke(harness.archiveSavedRecommendation, {
    id: String(record._id),
  });

  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  assert.equal(first.body.saved_recommendation.status, "ARCHIVED");
  assert.equal(second.body.saved_recommendation.status, "ARCHIVED");
  assert.equal(harness.calls.findOneAndUpdate.length, 2);
});

test("malformed, missing, and cross-user archive attempts share generic 404 behavior", async (t) => {
  await t.test("malformed id", async () => {
    const harness = makeModelHarness();
    const state = await invoke(harness.archiveSavedRecommendation, {
      id: "not-an-object-id",
    });
    assert.equal(state.statusCode, 404);
    assert.equal(harness.calls.findOneAndUpdate.length, 0);
  });

  for (const name of ["missing record", "cross-user record"]) {
    await t.test(name, async () => {
      const harness = makeModelHarness({ archiveResult: null });
      const id = new mongoose.Types.ObjectId().toString();
      const state = await invoke(harness.archiveSavedRecommendation, { id });
      assert.equal(state.statusCode, 404);
      assert.deepEqual(harness.calls.findOneAndUpdate[0].query, {
        _id: id,
        user: FARMER_ID,
      });
      assert.equal(state.body.message, "Saved recommendation not found");
    });
  }
});

test("read persistence failures return controlled server errors", async (t) => {
  const cases = [
    [
      "list",
      makeModelHarness({ listError: new Error("secret list failure") }),
      "listSavedRecommendations",
      {},
      "Unable to list saved recommendations",
    ],
    [
      "detail",
      makeModelHarness({ findOneError: new Error("secret detail failure") }),
      "getSavedRecommendation",
      { id: new mongoose.Types.ObjectId().toString() },
      "Unable to read saved recommendation",
    ],
    [
      "archive",
      makeModelHarness({ archiveError: new Error("secret archive failure") }),
      "archiveSavedRecommendation",
      { id: new mongoose.Types.ObjectId().toString() },
      "Unable to archive saved recommendation",
    ],
  ];

  for (const [name, harness, controllerName, request, message] of cases) {
    await t.test(name, async () => {
      const state = await invoke(harness[controllerName], request);
      assert.equal(state.statusCode, 500);
      assert.deepEqual(state.body, { success: false, message });
      assert.doesNotMatch(JSON.stringify(state.body), /secret/i);
    });
  }
});
