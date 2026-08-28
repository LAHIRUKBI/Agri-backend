const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const User = require("../../src/models/User");
const farmerAuthMiddleware = require(
  "../../src/middlewares/farmerAuthMiddleware"
);

const originalExists = User.exists;

test.afterEach(() => {
  User.exists = originalExists;
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

test("valid farmer identity passes and preserves req.user.id", async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const req = { user: { id: userId } };
  const res = makeResponse();
  let nextCalls = 0;
  let receivedQuery;

  User.exists = async (query) => {
    receivedQuery = query;
    return { _id: userId };
  };

  await farmerAuthMiddleware(req, res, () => {
    nextCalls += 1;
  });

  assert.deepEqual(receivedQuery, { _id: userId, role: "farmer" });
  assert.equal(req.user.id, userId);
  assert.equal(nextCalls, 1);
  assert.equal(res.state.statusCode, null);
});

test("missing authenticated user ID is rejected without a database query", async () => {
  const res = makeResponse();
  let queryCalls = 0;

  User.exists = async () => {
    queryCalls += 1;
    return null;
  };

  await farmerAuthMiddleware({ user: {} }, res, () => assert.fail("next called"));

  assert.equal(queryCalls, 0);
  assert.equal(res.state.statusCode, 403);
  assert.deepEqual(res.state.body, {
    success: false,
    message: "Farmer access required",
  });
});

test("malformed ObjectId is rejected safely before querying", async () => {
  const res = makeResponse();
  let queryCalls = 0;

  User.exists = async () => {
    queryCalls += 1;
    return null;
  };

  await farmerAuthMiddleware(
    { user: { id: "not-an-object-id" } },
    res,
    () => assert.fail("next called")
  );

  assert.equal(queryCalls, 0);
  assert.equal(res.state.statusCode, 403);
});

test("nonexistent User is rejected generically", async () => {
  const res = makeResponse();
  User.exists = async () => null;

  await farmerAuthMiddleware(
    { user: { id: new mongoose.Types.ObjectId().toString() } },
    res,
    () => assert.fail("next called")
  );

  assert.equal(res.state.statusCode, 403);
  assert.equal(res.state.body.message, "Farmer access required");
});

test("non-farmer identity is rejected without revealing account type", async () => {
  const res = makeResponse();
  let receivedQuery;

  User.exists = async (query) => {
    receivedQuery = query;
    return null;
  };

  await farmerAuthMiddleware(
    { user: { id: new mongoose.Types.ObjectId().toString() } },
    res,
    () => assert.fail("next called")
  );

  assert.equal(receivedQuery.role, "farmer");
  assert.equal(res.state.statusCode, 403);
  assert.deepEqual(res.state.body, {
    success: false,
    message: "Farmer access required",
  });
});

test("database failures return a controlled server error", async () => {
  const res = makeResponse();
  User.exists = async () => {
    throw new Error("database unavailable");
  };

  await farmerAuthMiddleware(
    { user: { id: new mongoose.Types.ObjectId().toString() } },
    res,
    () => assert.fail("next called")
  );

  assert.equal(res.state.statusCode, 500);
  assert.deepEqual(res.state.body, {
    success: false,
    message: "Unable to verify farmer access",
  });
});

test("middleware relies on req.user and does not require JWT headers", async () => {
  const userId = new mongoose.Types.ObjectId().toString();
  const req = { user: { id: userId }, headers: {} };
  const res = makeResponse();
  let nextCalls = 0;

  User.exists = async () => ({ _id: userId });

  await farmerAuthMiddleware(req, res, () => {
    nextCalls += 1;
  });

  assert.equal(nextCalls, 1);
  assert.equal(res.state.statusCode, null);
});
