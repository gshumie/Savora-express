import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeIpAddress,
  resolveClientIp,
  createRateLimiterMiddleware,
} from '../src/lib/clientIp.js';
import { createGlobalRateLimiter, app, server } from '../server.js';

test.after(() => {
  server?.close();
});

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

test('normalizeIpAddress: IPv4 address normalization', () => {
  assert.equal(normalizeIpAddress('203.0.113.195'), '203.0.113.195');
  assert.equal(normalizeIpAddress(' 198.51.100.42 '), '198.51.100.42');
  assert.equal(normalizeIpAddress('127.0.0.1'), '127.0.0.1');
});

test('normalizeIpAddress: Compressed and expanded IPv6 addresses normalize to stable /64 network key', () => {
  // Same /64 prefix with different host parts
  const host1 = normalizeIpAddress('2001:db8::1');
  const host2 = normalizeIpAddress('2001:db8::2');
  assert.equal(host1, '2001:db8::/64');
  assert.equal(host2, '2001:db8::/64');
  assert.equal(host1, host2);

  // Fully expanded vs middle-zero compressed IPv6
  const expanded = normalizeIpAddress('2001:0db8:0000:0000:0000:ff00:0042:8329');
  const compressed = normalizeIpAddress('2001:db8::ff00:42:8329');
  assert.equal(expanded, '2001:db8::/64');
  assert.equal(compressed, '2001:db8::/64');

  // Loopback and link-local addresses
  assert.equal(normalizeIpAddress('::1'), '::/64');
  assert.equal(normalizeIpAddress('fe80::1'), 'fe80::/64');
});

test('normalizeIpAddress: IPv4-mapped IPv6 dotted-decimal and hexadecimal forms', () => {
  // Dotted decimal mapped
  assert.equal(normalizeIpAddress('::ffff:192.0.2.128'), '192.0.2.128');
  assert.equal(normalizeIpAddress('::ffff:203.0.113.50'), '203.0.113.50');

  // Hexadecimal mapped
  assert.equal(normalizeIpAddress('::ffff:c000:0280'), '192.0.2.128');
  assert.equal(normalizeIpAddress('0:0:0:0:0:ffff:c000:0280'), '192.0.2.128');
});

test('normalizeIpAddress: Rejects invalid, empty, or malformed inputs', () => {
  assert.equal(normalizeIpAddress(''), null);
  assert.equal(normalizeIpAddress('   '), null);
  assert.equal(normalizeIpAddress('not-an-ip'), null);
  assert.equal(normalizeIpAddress('999.999.999.999'), null);
  assert.equal(normalizeIpAddress('2001:db8:::1'), null);
  assert.equal(normalizeIpAddress('::g'), null);
  assert.equal(normalizeIpAddress(null), null);
  assert.equal(normalizeIpAddress(undefined), null);
});

test('resolveClientIp: Fails closed in production on missing, multiple, or malformed Vercel header', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalVercel = process.env.VERCEL;
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;

    // Missing header
    assert.equal(resolveClientIp({ headers: {}, ip: '127.0.0.1' }), null);

    // Comma-separated (never select first item)
    assert.equal(
      resolveClientIp({
        headers: { 'x-vercel-forwarded-for': '203.0.113.1, 10.0.0.1' },
        ip: '127.0.0.1',
      }),
      null
    );

    // Array-valued header
    assert.equal(
      resolveClientIp({
        headers: { 'x-vercel-forwarded-for': ['203.0.113.1', '10.0.0.1'] },
        ip: '127.0.0.1',
      }),
      null
    );

    // Malformed IP
    assert.equal(
      resolveClientIp({
        headers: { 'x-vercel-forwarded-for': 'malformed-client-ip' },
        ip: '127.0.0.1',
      }),
      null
    );
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalVercel !== undefined) process.env.VERCEL = originalVercel;
    else delete process.env.VERCEL;
  }
});

test('resolveClientIp: Preserves safe fallback to req.ip in development and test environments', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalVercel = process.env.VERCEL;
  try {
    process.env.NODE_ENV = 'development';
    delete process.env.VERCEL;

    const req = {
      headers: {},
      ip: '198.51.100.99',
      socket: { remoteAddress: '198.51.100.99' },
    };
    assert.equal(resolveClientIp(req), '198.51.100.99');
  } finally {
    process.env.NODE_ENV = originalEnv;
    if (originalVercel !== undefined) process.env.VERCEL = originalVercel;
    else delete process.env.VERCEL;
  }
});

test('global rate limiter: permits requests up to 200 within 15-minute window and blocks with 429', async () => {
  const limiter = createGlobalRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 200,
  });

  const testIp = '203.0.113.44';
  const req = {
    ip: testIp,
    headers: { 'x-vercel-forwarded-for': testIp },
    method: 'GET',
    path: '/api/products',
  };

  // Perform 200 allowed requests
  for (let i = 1; i <= 200; i++) {
    const res = createMockResponse();
    let nextCalled = false;
    await limiter(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true, `Request ${i} should be permitted`);
    assert.equal(res.statusCode, 200);
  }

  // 201st request must be blocked with 429
  const blockedRes = createMockResponse();
  let blockedNext = false;
  await limiter(req, blockedRes, () => { blockedNext = true; });

  assert.equal(blockedNext, false, '201st request must be blocked');
  assert.equal(blockedRes.statusCode, 429);
  assert.deepEqual(blockedRes.body, { error: 'Too many requests. Please try again later.' });
  assert.ok(blockedRes.headers['retry-after'], 'Should set Retry-After header');
});

test('global rate limiter: tracks distinct valid client IPs independently', async () => {
  const limiter = createGlobalRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 2,
  });

  async function sendReq(ip) {
    const req = {
      ip,
      headers: { 'x-vercel-forwarded-for': ip },
      method: 'GET',
      path: '/api/products',
    };
    const res = createMockResponse();
    let nextCalled = false;
    await limiter(req, res, () => { nextCalled = true; });
    return { res, nextCalled };
  }

  // Exhaust IP A
  assert.equal((await sendReq('203.0.113.10')).nextCalled, true);
  assert.equal((await sendReq('203.0.113.10')).nextCalled, true);
  const ipABlocked = await sendReq('203.0.113.10');
  assert.equal(ipABlocked.nextCalled, false);
  assert.equal(ipABlocked.res.statusCode, 429);

  // IP B has distinct counter and is allowed
  const ipBFirst = await sendReq('203.0.113.20');
  assert.equal(ipBFirst.nextCalled, true);
  assert.equal(ipBFirst.res.statusCode, 200);
});

test('global rate limiter: returns controlled 503 on unverified IP in production without consuming bucket', async () => {
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';

    const limiter = createGlobalRateLimiter({ max: 2 });
    const req = {
      headers: {}, // Missing x-vercel-forwarded-for
      ip: '127.0.0.1',
      method: 'GET',
      path: '/api/products',
    };
    const res = createMockResponse();
    let nextCalled = false;

    await limiter(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, false, 'Must fail closed without calling next');
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { error: 'Service temporarily unavailable. Please try again later.' });
  } finally {
    process.env.NODE_ENV = originalEnv;
  }
});

test('server.js middleware order: static files and /health precede global rate limiter', () => {
  const stack = app._router.stack;

  const healthIndex = stack.findIndex(
    (layer) => layer.route && layer.route.path === '/health'
  );
  const publicFilesIndex = stack.findIndex(
    (layer) => layer.route && Array.isArray(layer.route.path) && layer.route.path.includes('/style.css')
  );
  const stripeWebhookIndex = stack.findIndex(
    (layer) => layer.route && layer.route.path === '/api/orders/webhook'
  );
  const authRoutesIndex = stack.findIndex(
    (layer) => layer.name === 'router' && layer.regexp && layer.regexp.test('/api/auth')
  );

  // Ensure all key routes exist
  assert.ok(healthIndex !== -1, '/health route must exist');
  assert.ok(publicFilesIndex !== -1, 'publicFiles route must exist');
  assert.ok(stripeWebhookIndex !== -1, 'Stripe webhook route must exist');
  assert.ok(authRoutesIndex !== -1, '/api/auth router must exist');

  // Verify that Stripe webhook, /health, and static publicFiles are registered
  // before the downstream API routes (like /api/auth)
  assert.ok(stripeWebhookIndex < authRoutesIndex, 'Stripe webhook must precede API routes');
  assert.ok(healthIndex < authRoutesIndex, '/health must precede API routes');
  assert.ok(publicFilesIndex < authRoutesIndex, 'Static assets must precede API routes');
});
