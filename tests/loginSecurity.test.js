import test from 'node:test';
import assert from 'node:assert/strict';

import { comparePassword, DUMMY_PASSWORD_HASH } from '../src/lib/auth.js';
import { parseRateLimitInteger, resolveRateLimitConfigVar } from '../src/config.js';
import {
  createAuthRouter,
  createLoginRateLimiter,
  normalizeIpAddress,
  resolveClientIp,
} from '../src/routes/authRoutes.js';

const userFixture = {
  id: 'user-1',
  name: 'Test User',
  email: 'registered@example.test',
  role: 'CUSTOMER',
  passwordHash: '$2b$12$registeredUserPasswordHashSentinelValue0123456789012345',
};

function createMemoryDatabase({ users = [] } = {}) {
  const state = { users: [...users], sessions: [] };
  let nextSessionId = 0;

  return {
    state,
    user: {
      findUnique: async ({ where }) => state.users.find((user) => (
        (where.id && user.id === where.id)
        || (where.email && user.email === where.email)
      )) || null,
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
    },
  };
}

function createMockResponse() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    headers,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
      return this;
    },
    getHeader(name) {
      return headers[name.toLowerCase()];
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('DUMMY_PASSWORD_HASH is a valid bcrypt hash with work factor 12 and does not match arbitrary passwords', async () => {
  assert.equal(typeof DUMMY_PASSWORD_HASH, 'string');
  assert.equal(DUMMY_PASSWORD_HASH.length, 60);
  assert.ok(DUMMY_PASSWORD_HASH.startsWith('$2b$12$'), 'Must use bcrypt algorithm $2b$ with cost factor 12');

  const matches = await comparePassword('wrong-password', DUMMY_PASSWORD_HASH);
  assert.equal(matches, false);
});

test('login with unknown email executes comparePasswordFn against DUMMY_PASSWORD_HASH to prevent timing attacks', async () => {
  const database = createMemoryDatabase({ users: [userFixture] });
  const comparisons = [];

  const router = createAuthRouter({
    database,
    loginRateLimiter: null,
    comparePasswordFn: async (password, hash) => {
      comparisons.push({ password, hash });
      return false;
    },
  });

  const [loginHandler] = router.stack.find((entry) => entry.route?.path === '/login').route.stack.map((s) => s.handle);
  const req = {
    body: { email: 'unknown@example.test', password: 'submitted-password-123' },
  };
  const res = createMockResponse();

  await loginHandler(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Invalid email or password.' });
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].password, 'submitted-password-123');
  assert.equal(comparisons[0].hash, DUMMY_PASSWORD_HASH);
});

test('login with existing user runs comparePasswordFn against the user real passwordHash', async () => {
  const database = createMemoryDatabase({ users: [userFixture] });
  const comparisons = [];

  const router = createAuthRouter({
    database,
    loginRateLimiter: null,
    comparePasswordFn: async (password, hash) => {
      comparisons.push({ password, hash });
      return false;
    },
  });

  const [loginHandler] = router.stack.find((entry) => entry.route?.path === '/login').route.stack.map((s) => s.handle);
  const req = {
    body: { email: userFixture.email, password: 'attempted-password' },
  };
  const res = createMockResponse();

  await loginHandler(req, res);

  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Invalid email or password.' });
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].password, 'attempted-password');
  assert.equal(comparisons[0].hash, userFixture.passwordHash);
});

test('dedicated login rate limiter permits up to default 5 attempts and blocks the 6th with 429', async () => {
  const limiter = createLoginRateLimiter({
    windowMs: 60 * 1000,
    max: 5,
  });

  async function sendLoginAttempt(ip) {
    const req = {
      ip,
      headers: {},
      method: 'POST',
      path: '/api/auth/login',
    };
    const res = createMockResponse();
    let nextCalled = false;
    await limiter(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
  }

  const testIp = '198.51.100.42';

  for (let i = 1; i <= 5; i++) {
    const { res, nextCalled } = await sendLoginAttempt(testIp);
    assert.equal(nextCalled, true, `Attempt ${i} should be allowed`);
    assert.equal(res.statusCode, 200);
  }

  // 6th attempt from the same IP must be rejected
  const sixthAttempt = await sendLoginAttempt(testIp);
  assert.equal(sixthAttempt.nextCalled, false, '6th attempt must be blocked by rate limiter');
  assert.equal(sixthAttempt.res.statusCode, 429);
  assert.deepEqual(sixthAttempt.res.body, { error: 'Too many login attempts. Please try again later.' });
  assert.ok(sixthAttempt.res.headers['retry-after'], 'Should set Retry-After header');
});

test('login rate limiter tracks different IP addresses independently', async () => {
  const limiter = createLoginRateLimiter({
    windowMs: 60 * 1000,
    max: 2,
  });

  async function attempt(ip) {
    const req = { ip, headers: {}, method: 'POST', path: '/api/auth/login' };
    const res = createMockResponse();
    let nextCalled = false;
    await limiter(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
  }

  // Exhaust IP A
  assert.equal((await attempt('203.0.113.1')).nextCalled, true);
  assert.equal((await attempt('203.0.113.1')).nextCalled, true);
  const ipABlocked = await attempt('203.0.113.1');
  assert.equal(ipABlocked.nextCalled, false);
  assert.equal(ipABlocked.res.statusCode, 429);

  // IP B should still be allowed
  const ipBFirst = await attempt('203.0.113.2');
  assert.equal(ipBFirst.nextCalled, true);
  assert.equal(ipBFirst.res.statusCode, 200);
});

test('login rate limiter respects configurable max and windowMs parameters', async () => {
  const limiter = createLoginRateLimiter({
    windowMs: 10_000,
    max: 1,
    message: { error: 'Custom rate limit message.' },
  });

  const ip = '192.0.2.99';
  const req1 = { ip, headers: {}, method: 'POST', path: '/api/auth/login' };
  const res1 = createMockResponse();
  let next1 = false;
  await limiter(req1, res1, () => { next1 = true; });
  assert.equal(next1, true);

  const req2 = { ip, headers: {}, method: 'POST', path: '/api/auth/login' };
  const res2 = createMockResponse();
  let next2 = false;
  await limiter(req2, res2, () => { next2 = true; });
  assert.equal(next2, false);
  assert.equal(res2.statusCode, 429);
  assert.deepEqual(res2.body, { error: 'Custom rate limit message.' });
});

test('normalizeIpAddress normalizes IPv4 client address consistently', () => {
  assert.equal(normalizeIpAddress('203.0.113.195'), '203.0.113.195');
  assert.equal(normalizeIpAddress(' 198.51.100.1 '), '198.51.100.1');
  assert.equal(normalizeIpAddress('127.0.0.1'), '127.0.0.1');
});

test('normalizeIpAddress normalizes compressed IPv6 addresses to /64 using ipaddr.js', () => {
  // Hosts on the same /64 subnet must produce the exact same normalized prefix
  const host1 = normalizeIpAddress('2001:db8::1');
  const host2 = normalizeIpAddress('2001:db8::2');
  assert.equal(host1, '2001:db8::/64');
  assert.equal(host2, '2001:db8::/64');
  assert.equal(host1, host2);

  // Full expansion and middle zero compression produce the exact same prefix
  const expanded = normalizeIpAddress('2001:0db8:0000:0000:0000:ff00:0042:8329');
  const compressed = normalizeIpAddress('2001:db8::ff00:42:8329');
  assert.equal(expanded, '2001:db8::/64');
  assert.equal(compressed, '2001:db8::/64');

  // Loopback and link-local IPv6 addresses
  assert.equal(normalizeIpAddress('::1'), '::/64');
  assert.equal(normalizeIpAddress('fe80::1'), 'fe80::/64');
});

test('normalizeIpAddress normalizes IPv4-mapped IPv6 address to canonical IPv4', () => {
  assert.equal(normalizeIpAddress('::ffff:192.0.2.128'), '192.0.2.128');
  assert.equal(normalizeIpAddress('::ffff:c000:0280'), '192.0.2.128');
  assert.equal(normalizeIpAddress('::ffff:203.0.113.50'), '203.0.113.50');
});

test('normalizeIpAddress returns null for invalid IP strings', () => {
  assert.equal(normalizeIpAddress(''), null);
  assert.equal(normalizeIpAddress('   '), null);
  assert.equal(normalizeIpAddress('not-an-ip'), null);
  assert.equal(normalizeIpAddress('999.999.999.999'), null);
  assert.equal(normalizeIpAddress('2001:db8:::1'), null);
  assert.equal(normalizeIpAddress('::g'), null);
  assert.equal(normalizeIpAddress(null), null);
  assert.equal(normalizeIpAddress(undefined), null);
  assert.equal(normalizeIpAddress(12345), null);
});

test('resolveClientIp and limiter reject missing Vercel header in production with HTTP 503', async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalVercel = process.env.VERCEL;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;

    const req = {
      headers: {},
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      method: 'POST',
      path: '/api/auth/login',
    };

    // Client IP resolution must not fall back to req.ip in production
    assert.equal(resolveClientIp(req), null);

    const limiter = createLoginRateLimiter({ max: 5 });
    const res = createMockResponse();
    let nextCalled = false;

    await limiter(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'Middleware must not call next in production when header is missing');
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'Service temporarily unavailable. Please try again later.' });
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalVercel !== undefined) {
      process.env.VERCEL = originalVercel;
    } else {
      delete process.env.VERCEL;
    }
  }
});

test('resolveClientIp and limiter reject multiple or comma-separated header values in production with HTTP 503', async () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    // Comma-separated string: must not take the first item
    const commaSeparatedReq = {
      headers: { 'x-vercel-forwarded-for': '203.0.113.195, 198.51.100.1' },
      ip: '127.0.0.1',
      method: 'POST',
      path: '/api/auth/login',
    };
    assert.equal(resolveClientIp(commaSeparatedReq), null);

    const limiter = createLoginRateLimiter({ max: 5 });
    const res1 = createMockResponse();
    let next1 = false;
    await limiter(commaSeparatedReq, res1, () => { next1 = true; });
    assert.equal(next1, false);
    assert.equal(res1.statusCode, 503);
    assert.deepEqual(res1.body, { error: 'Service temporarily unavailable. Please try again later.' });

    // Header array with multiple values
    const arrayReq = {
      headers: { 'x-vercel-forwarded-for': ['203.0.113.195', '198.51.100.1'] },
      ip: '127.0.0.1',
      method: 'POST',
      path: '/api/auth/login',
    };
    assert.equal(resolveClientIp(arrayReq), null);

    const res2 = createMockResponse();
    let next2 = false;
    await limiter(arrayReq, res2, () => { next2 = true; });
    assert.equal(next2, false);
    assert.equal(res2.statusCode, 503);
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('resolveClientIp and limiter reject invalid IP string in production with HTTP 503', async () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    const req = {
      headers: { 'x-vercel-forwarded-for': 'invalid-client-ip' },
      ip: '127.0.0.1',
      method: 'POST',
      path: '/api/auth/login',
    };
    assert.equal(resolveClientIp(req), null);

    const limiter = createLoginRateLimiter({ max: 5 });
    const res = createMockResponse();
    let nextCalled = false;
    await limiter(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'Service temporarily unavailable. Please try again later.' });
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('resolveClientIp preserves req.ip fallback in local development and test environments', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalVercel = process.env.VERCEL;
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;

    const req = {
      headers: {},
      ip: '198.51.100.77',
      socket: { remoteAddress: '198.51.100.77' },
    };
    assert.equal(resolveClientIp(req), '198.51.100.77');
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalVercel !== undefined) {
      process.env.VERCEL = originalVercel;
    } else {
      delete process.env.VERCEL;
    }
  }
});

test('login rate limiter aggregates different hosts on the same IPv6 /64 prefix into one bucket', async () => {
  const limiter = createLoginRateLimiter({
    windowMs: 60 * 1000,
    max: 2,
  });

  async function attemptWithHeader(ip) {
    const req = {
      headers: { 'x-vercel-forwarded-for': ip },
      ip: '127.0.0.1',
      method: 'POST',
      path: '/api/auth/login',
    };
    const res = createMockResponse();
    let nextCalled = false;
    await limiter(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
  }

  // Attempt 1 from 2001:db8::1 (allowed)
  const first = await attemptWithHeader('2001:db8::1');
  assert.equal(first.nextCalled, true);
  assert.equal(first.res.statusCode, 200);

  // Attempt 2 from 2001:db8::2 (allowed, same /64 bucket)
  const second = await attemptWithHeader('2001:db8::2');
  assert.equal(second.nextCalled, true);
  assert.equal(second.res.statusCode, 200);

  // Attempt 3 from 2001:db8::3 (blocked with 429 because /64 prefix is exhausted)
  const third = await attemptWithHeader('2001:db8::3');
  assert.equal(third.nextCalled, false);
  assert.equal(third.res.statusCode, 429);
});

test('rate-limit config validation: respects defaults when values are unset or empty', () => {
  assert.equal(
    parseRateLimitInteger({
      value: undefined,
      name: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS',
      min: 1000,
      max: 86400000,
      defaultValue: 60000,
      isProduction: true,
    }),
    60000
  );

  assert.equal(
    parseRateLimitInteger({
      value: '',
      name: 'AUTH_LOGIN_RATE_LIMIT_MAX',
      min: 1,
      max: 10000,
      defaultValue: 5,
      isProduction: true,
    }),
    5
  );

  assert.equal(
    parseRateLimitInteger({
      value: '   ',
      name: 'AUTH_LOGIN_RATE_LIMIT_MAX',
      min: 1,
      max: 10000,
      defaultValue: 5,
      isProduction: true,
    }),
    5
  );
});

test('rate-limit config validation: respects lower and upper boundaries', () => {
  // WindowMs boundaries: 1000 to 86400000
  assert.equal(
    parseRateLimitInteger({
      value: '1000',
      name: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS',
      min: 1000,
      max: 86400000,
      defaultValue: 60000,
      isProduction: true,
    }),
    1000
  );

  assert.equal(
    parseRateLimitInteger({
      value: '86400000',
      name: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS',
      min: 1000,
      max: 86400000,
      defaultValue: 60000,
      isProduction: true,
    }),
    86400000
  );

  // Max boundaries: 1 to 10000
  assert.equal(
    parseRateLimitInteger({
      value: '1',
      name: 'AUTH_LOGIN_RATE_LIMIT_MAX',
      min: 1,
      max: 10000,
      defaultValue: 5,
      isProduction: true,
    }),
    1
  );

  assert.equal(
    parseRateLimitInteger({
      value: '10000',
      name: 'AUTH_LOGIN_RATE_LIMIT_MAX',
      min: 1,
      max: 10000,
      defaultValue: 5,
      isProduction: true,
    }),
    10000
  );
});

test('rate-limit config validation: invalid values fail startup in production without exposing values', () => {
  const invalidCases = [
    { name: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', value: '999', min: 1000, max: 86400000, defaultVal: 60000 },
    { name: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', value: '86400001', min: 1000, max: 86400000, defaultVal: 60000 },
    { name: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', value: 'five-minutes', min: 1000, max: 86400000, defaultVal: 60000 },
    { name: 'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS', value: '60000.5', min: 1000, max: 86400000, defaultVal: 60000 },
    { name: 'AUTH_LOGIN_RATE_LIMIT_MAX', value: '0', min: 1, max: 10000, defaultVal: 5 },
    { name: 'AUTH_LOGIN_RATE_LIMIT_MAX', value: '-1', min: 1, max: 10000, defaultVal: 5 },
    { name: 'AUTH_LOGIN_RATE_LIMIT_MAX', value: '10001', min: 1, max: 10000, defaultVal: 5 },
    { name: 'AUTH_LOGIN_RATE_LIMIT_MAX', value: 'ten', min: 1, max: 10000, defaultVal: 5 },
    { name: 'AUTH_LOGIN_RATE_LIMIT_MAX', value: '5.2', min: 1, max: 10000, defaultVal: 5 },
  ];

  for (const { name, value, min, max, defaultVal } of invalidCases) {
    assert.throws(
      () => {
        parseRateLimitInteger({
          value,
          name,
          min,
          max,
          defaultValue: defaultVal,
          isProduction: true,
        });
      },
      (error) => {
        assert.ok(error instanceof Error);
        // Must name the variable and safe bounds, but never expose the raw invalid value
        assert.equal(error.message, `Invalid ${name}: must be an integer between ${min} and ${max}.`);
        return true;
      }
    );
  }
});

test('rate-limit config validation: alias resolution throws with alias name in production when invalid', () => {
  const originalPrimary = process.env.AUTH_LOGIN_RATE_LIMIT_MAX;
  const originalAlias = process.env.LOGIN_RATE_LIMIT_MAX;
  try {
    delete process.env.AUTH_LOGIN_RATE_LIMIT_MAX;
    process.env.LOGIN_RATE_LIMIT_MAX = '0';

    assert.throws(
      () => {
        resolveRateLimitConfigVar('AUTH_LOGIN_RATE_LIMIT_MAX', 'LOGIN_RATE_LIMIT_MAX', 1, 10000, 5, true);
      },
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, 'Invalid LOGIN_RATE_LIMIT_MAX: must be an integer between 1 and 10000.');
        return true;
      }
    );
  } finally {
    if (originalPrimary !== undefined) process.env.AUTH_LOGIN_RATE_LIMIT_MAX = originalPrimary;
    else delete process.env.AUTH_LOGIN_RATE_LIMIT_MAX;
    if (originalAlias !== undefined) process.env.LOGIN_RATE_LIMIT_MAX = originalAlias;
    else delete process.env.LOGIN_RATE_LIMIT_MAX;
  }
});

test('rate-limit config validation: invalid values in development/test warn and fall back to default', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));

  try {
    const result = parseRateLimitInteger({
      value: 'not-an-integer',
      name: 'AUTH_LOGIN_RATE_LIMIT_MAX',
      min: 1,
      max: 10000,
      defaultValue: 5,
      isProduction: false,
    });

    assert.equal(result, 5);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0], '[config] Invalid AUTH_LOGIN_RATE_LIMIT_MAX. Falling back to default 5.');
  } finally {
    console.warn = originalWarn;
  }
});
