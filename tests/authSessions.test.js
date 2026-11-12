import test from 'node:test';
import assert from 'node:assert/strict';

import { verifyToken } from '../src/lib/auth.js';
import { createRequireAuth } from '../src/middleware/auth.js';
import { createAuthRouter } from '../src/routes/authRoutes.js';

const userFixture = {
  id: 'user-1',
  name: 'Test User',
  email: 'user@example.test',
  role: 'CUSTOMER',
  passwordHash: 'test-hash',
};

function createMemoryDatabase({ users = [], sessions = [] } = {}) {
  let nextSessionId = 0;
  const state = { users: [...users], sessions: [...sessions] };

  const database = {
    state,
    user: {
      findUnique: async ({ where }) => state.users.find((user) => (
        (where.id && user.id === where.id)
        || (where.email && user.email === where.email)
      )) || null,
      create: async ({ data }) => {
        const user = { id: `user-${state.users.length + 1}`, ...data, role: 'CUSTOMER' };
        state.users.push(user);
        return user;
      },
    },
    authSession: {
      create: async ({ data }) => {
        const session = {
          id: `auth-session-${++nextSessionId}`,
          createdAt: new Date(),
          revokedAt: null,
          ...data,
        };
        state.sessions.push(session);
        return session;
      },
      findFirst: async ({ where }) => {
        const session = state.sessions.find((candidate) => (
          candidate.id === where.id
          && candidate.userId === where.userId
          && candidate.revokedAt === where.revokedAt
          && candidate.expiresAt > where.expiresAt.gt
        ));
        if (!session) return null;
        const user = state.users.find((candidate) => candidate.id === session.userId);
        return user ? { ...session, user } : { ...session, user: null };
      },
      updateMany: async ({ where, data }) => {
        const session = state.sessions.find((candidate) => (
          candidate.id === where.id
          && candidate.userId === where.userId
          && candidate.revokedAt === where.revokedAt
        ));
        if (!session) return { count: 0 };
        Object.assign(session, data);
        return { count: 1 };
      },
    },
    $transaction: async (callback) => callback(database),
  };

  return database;
}

function getRouteHandlers(router, path, method) {
  const layer = router.stack.find((entry) => (
    entry.route?.path === path && entry.route.methods[method]
  ));
  assert.ok(layer, `${method.toUpperCase()} ${path} route exists`);
  return layer.route.stack.map((entry) => entry.handle);
}

function createResponse() {
  return {
    statusCode: 200,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invokeHandler(handler, req) {
  const res = createResponse();
  await handler(req, res);
  return res;
}

function createTokenRequest(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

test('registration creates a persistent session and returns a JWT containing its sid', async () => {
  const database = createMemoryDatabase();
  const router = createAuthRouter({
    database,
    hashPasswordFn: async () => 'hashed-password',
  });
  const [handler] = getRouteHandlers(router, '/register', 'post');
  const response = await invokeHandler(handler, {
    body: { name: ' Test User ', email: 'USER@example.test', password: 'password' },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(database.state.sessions.length, 1);
  const session = database.state.sessions[0];
  assert.equal(session.userId, response.body.user.id);
  assert.ok(session.expiresAt > session.createdAt);
  const payload = verifyToken(response.body.token);
  assert.equal(payload.sid, session.id);
  assert.equal(payload.userId, session.userId);
});

test('successful login creates a new persistent session and signs its sid into the JWT', async () => {
  const database = createMemoryDatabase({ users: [userFixture] });
  const router = createAuthRouter({
    database,
    comparePasswordFn: async () => true,
  });
  const [, handler] = getRouteHandlers(router, '/login', 'post');
  const response = await invokeHandler(handler, {
    body: { email: userFixture.email, password: 'valid-password' },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(database.state.sessions.length, 1);
  const session = database.state.sessions[0];
  assert.equal(session.userId, userFixture.id);
  const payload = verifyToken(response.body.token);
  assert.equal(payload.sid, session.id);
  assert.equal(payload.userId, userFixture.id);
});

test('authentication accepts only an active unexpired session belonging to the JWT user', async () => {
  const now = new Date('2026-11-01T10:00:00.000Z');
  const activeSession = {
    id: 'active-session',
    userId: userFixture.id,
    createdAt: new Date(now.getTime() - 1000),
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
  };
  const database = createMemoryDatabase({
    users: [userFixture],
    sessions: [activeSession],
  });
  const middleware = createRequireAuth({
    database,
    tokenVerifier: () => ({ userId: userFixture.id, sid: activeSession.id }),
    now: () => now,
  });
  const req = createTokenRequest('test-token');
  let nextCalled = false;
  await middleware(req, createResponse(), () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(req.authSession, { id: activeSession.id, userId: userFixture.id });
  assert.equal(req.user.id, userFixture.id);
});

test('authentication rejects missing, expired, revoked, and wrong-owner sessions and legacy JWTs', async () => {
  const now = new Date('2026-11-01T10:00:00.000Z');
  const session = {
    id: 'candidate-session',
    userId: userFixture.id,
    expiresAt: new Date(now.getTime() + 60_000),
    revokedAt: null,
  };
  const database = createMemoryDatabase({
    users: [userFixture],
    sessions: [
      session,
      { ...session, id: 'expired-session', expiresAt: new Date(now.getTime() - 1) },
      { ...session, id: 'revoked-session', revokedAt: new Date(now.getTime() - 1) },
    ],
  });

  for (const payload of [
    { userId: userFixture.id, sid: 'missing-session' },
    { userId: userFixture.id, sid: 'expired-session' },
    { userId: userFixture.id, sid: 'revoked-session' },
    { userId: 'different-user', sid: session.id },
    { userId: userFixture.id },
  ]) {
    const middleware = createRequireAuth({
      database,
      tokenVerifier: () => payload,
      now: () => now,
    });
    let nextCalled = false;
    const response = await invokeHandler(
      (req, res) => middleware(req, res, () => { nextCalled = true; }),
      createTokenRequest('test-token'),
    );

    assert.equal(response.statusCode, 401);
    assert.equal(nextCalled, false);
  }
});

test('database errors fail authentication closed without calling next', async () => {
  const database = createMemoryDatabase({ users: [userFixture] });
  database.authSession.findFirst = async () => {
    throw new Error('test database failure');
  };
  const middleware = createRequireAuth({
    database,
    tokenVerifier: () => ({ userId: userFixture.id, sid: 'active-session' }),
  });
  let nextCalled = false;
  const response = await invokeHandler(
    (req, res) => middleware(req, res, () => { nextCalled = true; }),
    createTokenRequest('test-token'),
  );

  assert.equal(response.statusCode, 503);
  assert.equal(nextCalled, false);
});

test('logout revokes only the current session and a repeated logout is rejected', async () => {
  const database = createMemoryDatabase({ users: [userFixture] });
  const middleware = createRequireAuth({ database });
  const router = createAuthRouter({
    database,
    comparePasswordFn: async () => true,
    requireAuthMiddleware: middleware,
  });
  const [, loginHandler] = getRouteHandlers(router, '/login', 'post');
  const loginResponse = await invokeHandler(loginHandler, {
    body: { email: userFixture.email, password: 'valid-password' },
  });
  const otherSession = await database.authSession.create({
    data: {
      userId: userFixture.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const loginPayload = verifyToken(loginResponse.body.token);
  assert.equal(loginPayload.sid, database.state.sessions[0].id);
  assert.equal(loginPayload.userId, userFixture.id);
  const [authMiddleware, logoutHandler] = getRouteHandlers(router, '/logout', 'post');
  const req = createTokenRequest(loginResponse.body.token);
  const middlewareResponse = createResponse();
  let nextCalled = false;
  await authMiddleware(req, middlewareResponse, () => { nextCalled = true; });
  assert.equal(nextCalled, true, JSON.stringify(middlewareResponse.body));
  const logoutResponse = await invokeHandler(logoutHandler, req);

  assert.equal(logoutResponse.statusCode, 200);
  assert.ok(database.state.sessions.find((session) => session.id === req.authSession.id).revokedAt);
  assert.equal(database.state.sessions.find((session) => session.id === otherSession.id).revokedAt, null);

  const repeatedLogoutResponse = await invokeHandler(
    (request, response) => authMiddleware(request, response, () => { nextCalled = true; }),
    createTokenRequest(loginResponse.body.token),
  );
  assert.equal(repeatedLogoutResponse.statusCode, 401);
  assert.equal(database.state.sessions.find((session) => session.id === req.authSession.id).revokedAt !== null, true);
});


test('concurrent sessions: logging out of one session revokes it, preserves other active sessions, and rejects expired sessions', async () => {
  let currentTime = new Date('2026-11-01T12:00:00.000Z');
  const database = createMemoryDatabase({ users: [userFixture] });
  const middleware = createRequireAuth({
    database,
    now: () => currentTime,
  });
  const router = createAuthRouter({
    database,
    comparePasswordFn: async () => true,
    requireAuthMiddleware: middleware,
  });

  const [, loginHandler] = getRouteHandlers(router, '/login', 'post');
  const [authMiddleware, logoutHandler] = getRouteHandlers(router, '/logout', 'post');
  const [, profileHandler] = getRouteHandlers(router, '/profile', 'get');

  async function callProtectedEndpoint(token, handler) {
    const req = createTokenRequest(token);
    const res = createResponse();
    let nextCalled = false;
    await authMiddleware(req, res, () => { nextCalled = true; });
    if (!nextCalled) return res;
    await handler(req, res);
    return res;
  }

  // 1. Login session A
  const loginResA = await invokeHandler(loginHandler, {
    body: { email: userFixture.email, password: 'valid-password' },
  });
  assert.equal(loginResA.statusCode, 200);
  const tokenA = loginResA.body.token;
  const payloadA = verifyToken(tokenA);
  assert.ok(payloadA.sid, 'Token A must include sid');
  assert.equal(payloadA.userId, userFixture.id);

  // 2. Login session B
  const loginResB = await invokeHandler(loginHandler, {
    body: { email: userFixture.email, password: 'valid-password' },
  });
  assert.equal(loginResB.statusCode, 200);
  const tokenB = loginResB.body.token;
  const payloadB = verifyToken(tokenB);
  assert.ok(payloadB.sid, 'Token B must include sid');
  assert.notEqual(payloadA.sid, payloadB.sid, 'Sessions A and B must have distinct sid values');
  assert.equal(database.state.sessions.length, 2);

  // 3. Both sessions can access protected profile route
  const profileResA1 = await callProtectedEndpoint(tokenA, profileHandler);
  assert.equal(profileResA1.statusCode, 200);
  assert.equal(profileResA1.body.user.id, userFixture.id);

  const profileResB1 = await callProtectedEndpoint(tokenB, profileHandler);
  assert.equal(profileResB1.statusCode, 200);
  assert.equal(profileResB1.body.user.id, userFixture.id);

  // 4. Logout session A
  const logoutResA = await callProtectedEndpoint(tokenA, logoutHandler);
  assert.equal(logoutResA.statusCode, 200);
  assert.equal(logoutResA.body.success, true);

  // Verify DB state
  const sessionA = database.state.sessions.find((s) => s.id === payloadA.sid);
  const sessionB = database.state.sessions.find((s) => s.id === payloadB.sid);
  assert.ok(sessionA.revokedAt, 'Session A must be revoked');
  assert.equal(sessionB.revokedAt, null, 'Session B must NOT be revoked (preserved)');

  // 5. Token A is now rejected on profile and repeated logout
  const profileResA2 = await callProtectedEndpoint(tokenA, profileHandler);
  assert.equal(profileResA2.statusCode, 401);

  const logoutResA2 = await callProtectedEndpoint(tokenA, logoutHandler);
  assert.equal(logoutResA2.statusCode, 401);

  // 6. Token B remains valid and can access profile
  const profileResB2 = await callProtectedEndpoint(tokenB, profileHandler);
  assert.equal(profileResB2.statusCode, 200);
  assert.equal(profileResB2.body.user.id, userFixture.id);

  // 7. Advance time past session B expiration -> Token B is rejected as expired
  currentTime = new Date(sessionB.expiresAt.getTime() + 1000);
  const profileResB3 = await callProtectedEndpoint(tokenB, profileHandler);
  assert.equal(profileResB3.statusCode, 401);
});
