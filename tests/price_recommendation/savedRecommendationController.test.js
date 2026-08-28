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
  createSaveRecommendationController,
} = require("../../src/controllers/savedRecommendationController");
const marketRecommendationRoutes = require(
  "../../src/routes/marketRecommendationRoutes"
);

const FIXED_NOW = new Date("2026-08-26T04:30:00.000Z");
const AUTHENTICATED_USER_ID = new mongoose.Types.ObjectId().toString();

const validPayload = (overrides = {}) => ({
  recommendation_timestamp: "2026-08-26T04:00:00.000Z",
  crop: " beans ",
  farmer_district: " Colombo ",
  available_markets: ["kandy", "meegoda"],
  comparisons: [
    {
      market: "kandy",
      predicted_price_rs_kg: 215,
      raw_model_payload: "must not persist",
    },
  ],
  recommended_market: {
    market: " Kandy ",
    predicted_price_rs_kg: 215,
    internal_trace: "must not persist",
  },
  current_price: 200,
  current_price_source: "manual",
  experimental_price: 215,
  persistence_baseline: 200,
  market_outlook: {
    status: "MIXED",
    strength: "MODERATE",
    summary: "Signals are mixed.",
    provider_metadata: "must not persist",
  },
  action_decision: " REVIEW_CURRENT_MARKET ",
  action_authorized: false,
  quantity_kg: 100,
  ai_insights: {
    recommendation: "Review current conditions.",
    raw_prompt: "must not persist",
  },
  weather_forecast: {
    location: "Kandy",
    source: "Open-Meteo",
    days: [{ date: "2026-08-27", rainfall_mm: 2, provider_id: "hidden" }],
    request_headers: { authorization: "hidden" },
  },
  model_version: "run_013",
  policy_version: "persistence_primary_v1",
  horizon: 1,
  display_only: "unknown top-level fields are not persisted",
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

const existingRecommendation = (overrides = {}) => ({
  _id: new mongoose.Types.ObjectId(),
  crop: "beans",
  recommended_market: "Kandy",
  prediction_target_date: new Date("2026-09-02T04:30:00.000Z"),
  status: "ACTIVE",
  createdAt: new Date("2026-08-26T04:30:00.000Z"),
  ...overrides,
});

const makeHarness = (overrides = {}) => {
  const calls = {
    findOne: [],
    create: [],
    deleteOne: [],
    findNotifications: [],
    insertMany: [],
    deleteMany: [],
  };
  const savedId = new mongoose.Types.ObjectId();
  const findOneResults = overrides.findOneResults
    ? [...overrides.findOneResults]
    : [null];

  const SavedRecommendationModel = {
    async findOne(query) {
      calls.findOne.push(query);
      if (overrides.findOneError) throw overrides.findOneError;
      return findOneResults.length > 0 ? findOneResults.shift() : null;
    },
    async create(document) {
      calls.create.push(document);
      if (overrides.createError) throw overrides.createError;
      return {
        _id: savedId,
        ...document,
        createdAt: new Date(FIXED_NOW),
      };
    },
    async deleteOne(query) {
      calls.deleteOne.push(query);
      if (overrides.deleteOneError) throw overrides.deleteOneError;
      return { deletedCount: 1 };
    },
  };

  const NotificationModel = {
    async find(query) {
      calls.findNotifications.push(query);
      if (overrides.findNotificationsError) {
        throw overrides.findNotificationsError;
      }
      return overrides.existingNotifications || [];
    },
    async insertMany(documents) {
      calls.insertMany.push(documents);
      if (overrides.insertManyError) throw overrides.insertManyError;
      return documents.map((document) => ({
        _id: new mongoose.Types.ObjectId(),
        ...document,
      }));
    },
    async deleteMany(query) {
      calls.deleteMany.push(query);
      if (overrides.deleteManyError) throw overrides.deleteManyError;
      return { deletedCount: 1 };
    },
  };

  const controller = createSaveRecommendationController({
    SavedRecommendationModel,
    NotificationModel,
    now: () => new Date(FIXED_NOW),
  });

  return { controller, calls, savedId };
};

const invoke = async (controller, payload = validPayload(), userId) => {
  const req = {
    user: { id: userId || AUTHENTICATED_USER_ID },
    body: payload,
  };
  const res = makeResponse();
  await controller(req, res);
  return res.state;
};

const findRoute = (path, method) =>
  marketRecommendationRoutes.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method]
  )?.route;

test("save route uses auth, farmer guard, then controller while original POST stays public", () => {
  const saveRoute = findRoute("/recommend-market/saved", "post");
  const originalRoute = findRoute("/recommend-market", "post");

  assert.ok(saveRoute);
  assert.deepEqual(
    saveRoute.stack.map((layer) => layer.handle),
    [authMiddleware, farmerAuthMiddleware, saveRecommendation]
  );
  assert.ok(originalRoute);
  assert.deepEqual(
    originalRoute.stack.map((layer) => layer.handle),
    [recommendBestMarket]
  );
});

test("save route rejects unauthenticated requests through auth middleware", () => {
  const [authLayer] = findRoute("/recommend-market/saved", "post").stack;
  const res = makeResponse();
  let nextCalls = 0;

  authLayer.handle({ headers: {} }, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 0);
  assert.equal(res.state.statusCode, 401);
  assert.deepEqual(res.state.body, { error: "No token provided" });
});

test("save route rejects authenticated identities without a farmer User", async (t) => {
  const originalExists = User.exists;
  t.after(() => {
    User.exists = originalExists;
  });
  User.exists = async () => null;

  const farmerLayer = findRoute("/recommend-market/saved", "post").stack[1];
  const res = makeResponse();
  let nextCalls = 0;

  await farmerLayer.handle(
    { user: { id: AUTHENTICATED_USER_ID } },
    res,
    () => {
      nextCalls += 1;
    }
  );

  assert.equal(nextCalls, 0);
  assert.equal(res.state.statusCode, 403);
  assert.deepEqual(res.state.body, {
    success: false,
    message: "Farmer access required",
  });
});

test("authenticated farmer save derives ownership, schedule, snapshot, and two reminders server-side", async () => {
  const { controller, calls, savedId } = makeHarness();
  const state = await invoke(controller);

  assert.equal(state.statusCode, 201);
  assert.equal(state.body.success, true);
  assert.equal(state.body.already_saved, false);
  assert.equal(calls.create.length, 1);

  const saved = calls.create[0];
  assert.equal(saved.user, AUTHENTICATED_USER_ID);
  assert.equal(saved.crop, "beans");
  assert.equal(saved.farmer_district, "Colombo");
  assert.equal(saved.recommended_market, "Kandy");
  assert.equal(saved.status, "ACTIVE");
  assert.equal(
    saved.prediction_target_date.toISOString(),
    "2026-09-02T04:30:00.000Z"
  );
  assert.match(saved.recommendation_fingerprint, /^[0-9a-f]{64}$/);
  assert.notEqual(
    saved.prediction_target_date.toISOString(),
    "2026-09-02T04:00:00.000Z"
  );

  const snapshot = saved.recommendation_snapshot;
  assert.equal(snapshot.display_only, undefined);
  assert.equal(snapshot.recommended_market.internal_trace, undefined);
  assert.equal(snapshot.comparisons[0].raw_model_payload, undefined);
  assert.equal(snapshot.ai_insights.raw_prompt, undefined);
  assert.equal(snapshot.weather_forecast.request_headers, undefined);
  assert.equal(snapshot.weather_forecast.days[0].provider_id, undefined);

  assert.equal(calls.insertMany.length, 1);
  assert.equal(calls.insertMany[0].length, 2);
  const [dueSoon, due] = calls.insertMany[0];
  assert.equal(dueSoon.user, AUTHENTICATED_USER_ID);
  assert.equal(due.user, AUTHENTICATED_USER_ID);
  assert.equal(String(dueSoon.recommendation), String(savedId));
  assert.equal(String(due.recommendation), String(savedId));
  assert.equal(dueSoon.type, "RECOMMENDATION_DUE_SOON");
  assert.equal(due.type, "RECOMMENDATION_DUE");
  assert.equal(
    dueSoon.scheduled_for.toISOString(),
    "2026-09-01T04:30:00.000Z"
  );
  assert.equal(due.scheduled_for.toISOString(), "2026-09-02T04:30:00.000Z");
  assert.equal(dueSoon.title, "Beans recommendation due tomorrow");
  assert.match(dueSoon.message, /Kandy/);
  for (const notification of [dueSoon, due]) {
    assert.doesNotMatch(
      `${notification.title} ${notification.message}`,
      /sell now|best time to sell|\bwait\b|\bhold\b/i
    );
  }

  assert.equal(state.body.saved_recommendation.recommendation_fingerprint, undefined);
  assert.equal(state.body.saved_recommendation.recommendation_snapshot, undefined);
  assert.equal(state.body.reminders.length, 2);
  assert.deepEqual(Object.keys(state.body.reminders[0]).sort(), [
    "id",
    "scheduled_for",
    "type",
  ]);
});

test("server-controlled and sensitive top-level fields are rejected", async (t) => {
  const fields = [
    "user",
    "user_id",
    "owner",
    "recommendation_fingerprint",
    "prediction_target_date",
    "status",
    "createdAt",
    "updatedAt",
    "scheduled_for",
    "delivered_at",
    "read_at",
    "token",
    "jwt",
    "authorization",
    "password",
    "api_key",
    "apiKey",
    "secret",
  ];

  for (const field of fields) {
    await t.test(field, async () => {
      const { controller, calls } = makeHarness();
      const state = await invoke(controller, validPayload({ [field]: "forged" }));
      assert.equal(state.statusCode, 400);
      assert.equal(state.body.success, false);
      assert.equal(calls.findOne.length, 0);
      assert.equal(calls.create.length, 0);
    });
  }
});

test("required payload contract rejects malformed values", async (t) => {
  const cases = [
    ["missing recommendation timestamp", { recommendation_timestamp: undefined }],
    ["invalid recommendation timestamp", { recommendation_timestamp: "later" }],
    ["empty crop", { crop: " " }],
    ["empty district", { farmer_district: " " }],
    ["missing recommended market object", { recommended_market: null }],
    ["empty recommended market name", { recommended_market: { market: " " } }],
    ["zero current price", { current_price: 0 }],
    ["non-finite current price", { current_price: Infinity }],
    ["invalid current price source", { current_price_source: "estimate" }],
    ["zero quantity", { quantity_kg: 0 }],
    ["missing market outlook", { market_outlook: null }],
    ["invalid outlook status", { market_outlook: { status: "UNKNOWN", strength: "LOW" } }],
    ["invalid outlook strength", { market_outlook: { status: "MIXED", strength: "UNKNOWN" } }],
    ["empty action decision", { action_decision: "" }],
    ["non-boolean action authorization", { action_authorized: "false" }],
    ["unsupported horizon", { horizon: 2 }],
    ["negative experimental price", { experimental_price: -1 }],
    ["infinite persistence baseline", { persistence_baseline: Infinity }],
  ];

  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const { controller, calls } = makeHarness();
      const state = await invoke(controller, validPayload(overrides));
      assert.equal(state.statusCode, 400);
      assert.equal(state.body.success, false);
      assert.equal(calls.findOne.length, 0);
      assert.equal(calls.create.length, 0);
    });
  }
});

test("optional evidence and metadata may be absent or null", async () => {
  const { controller, calls } = makeHarness();
  const payload = validPayload({
    experimental_price: null,
    persistence_baseline: undefined,
    model_version: undefined,
    policy_version: null,
    comparisons: undefined,
    ai_insights: undefined,
    weather_forecast: undefined,
  });
  const state = await invoke(controller, payload);

  assert.equal(state.statusCode, 201);
  assert.equal(calls.create[0].experimental_price, null);
  assert.equal(calls.create[0].persistence_baseline, null);
  assert.equal(calls.create[0].model_version, null);
  assert.equal(calls.create[0].policy_version, null);
});

test("normal duplicate path returns the existing recommendation and reminders without writes", async () => {
  const existing = existingRecommendation();
  const notifications = [
    {
      _id: new mongoose.Types.ObjectId(),
      type: "RECOMMENDATION_DUE",
      scheduled_for: new Date("2026-09-02T04:30:00.000Z"),
    },
    {
      _id: new mongoose.Types.ObjectId(),
      type: "RECOMMENDATION_DUE_SOON",
      scheduled_for: new Date("2026-09-01T04:30:00.000Z"),
    },
  ];
  const { controller, calls } = makeHarness({
    findOneResults: [existing],
    existingNotifications: notifications,
  });
  const state = await invoke(controller);

  assert.equal(state.statusCode, 200);
  assert.equal(state.body.already_saved, true);
  assert.equal(state.body.saved_recommendation.id, String(existing._id));
  assert.deepEqual(
    state.body.reminders.map((reminder) => reminder.type),
    ["RECOMMENDATION_DUE_SOON", "RECOMMENDATION_DUE"]
  );
  assert.equal(calls.create.length, 0);
  assert.equal(calls.insertMany.length, 0);
});

test("E11000 create race resolves to idempotent success", async () => {
  const existing = existingRecommendation();
  const duplicateError = Object.assign(new Error("duplicate key"), {
    code: 11000,
  });
  const { controller, calls } = makeHarness({
    findOneResults: [null, existing],
    createError: duplicateError,
  });
  const state = await invoke(controller);

  assert.equal(state.statusCode, 200);
  assert.equal(state.body.already_saved, true);
  assert.equal(calls.findOne.length, 2);
  assert.equal(calls.create.length, 1);
  assert.equal(calls.insertMany.length, 0);
  assert.equal(state.body.message, undefined);
});

test("a later recommendation timestamp produces a different server fingerprint", async () => {
  const firstHarness = makeHarness();
  const secondHarness = makeHarness();

  assert.equal((await invoke(firstHarness.controller)).statusCode, 201);
  assert.equal(
    (
      await invoke(
        secondHarness.controller,
        validPayload({ recommendation_timestamp: "2026-08-26T05:00:00.000Z" })
      )
    ).statusCode,
    201
  );

  assert.notEqual(
    firstHarness.calls.create[0].recommendation_fingerprint,
    secondHarness.calls.create[0].recommendation_fingerprint
  );
});

test("notification failure removes partial reminders and the new recommendation", async () => {
  const { controller, calls, savedId } = makeHarness({
    insertManyError: new Error("notification write failed"),
  });
  const state = await invoke(controller);

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, {
    success: false,
    message: "Unable to save recommendation",
  });
  assert.deepEqual(calls.deleteMany, [{ recommendation: savedId }]);
  assert.deepEqual(calls.deleteOne, [
    { _id: savedId, user: AUTHENTICATED_USER_ID },
  ]);
});

test("unexpected database errors return a controlled 500 without details", async () => {
  const { controller } = makeHarness({
    findOneError: new Error("mongodb://secret-host connection failed"),
  });
  const state = await invoke(controller);

  assert.equal(state.statusCode, 500);
  assert.deepEqual(state.body, {
    success: false,
    message: "Unable to save recommendation",
  });
  assert.doesNotMatch(JSON.stringify(state.body), /mongodb|secret-host/i);
});
