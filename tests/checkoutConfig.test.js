import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

import { CURRENCY } from '../src/lib/money.js';
import { resolvePaymentProvider } from '../src/services/chapa.js';

const expectedFields = [
  'currency',
  'pricesApproved',
  'paymentProvider',
  'paymentEnvironment',
  'paymentAvailable',
  'provider',
  'chapaEnabled',
];
const serverSource = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const routeStart = serverSource.indexOf("app.get('/api/checkout-config'");
const routeEnd = serverSource.indexOf('app.get([...publicFiles.keys()]', routeStart);

assert.notEqual(routeStart, -1, 'checkout-config route should exist');
assert.notEqual(routeEnd, -1, 'checkout-config route should have a boundary');

function registerCheckoutConfigRoute(config) {
  let handler;
  const app = {
    get(routePath, routeHandler) {
      assert.equal(routePath, '/api/checkout-config');
      handler = routeHandler;
    },
  };

  runInNewContext(serverSource.slice(routeStart, routeEnd), {
    app,
    config,
    resolvePaymentProvider,
    CURRENCY,
  });

  assert.equal(typeof handler, 'function');
  return handler;
}

function getSerializedResponse(config) {
  let responseBody;
  registerCheckoutConfigRoute(config)({}, {
    json(body) {
      responseBody = body;
    },
  });

  return JSON.stringify(responseBody);
}

function assertPublicResponseShape(serializedResponse, expectedProvider, expectedEnvironment) {
  const response = JSON.parse(serializedResponse);
  assert.deepEqual(Object.keys(response), expectedFields);
  assert.deepEqual(response, {
    currency: CURRENCY,
    pricesApproved: false,
    paymentProvider: expectedProvider,
    paymentEnvironment: expectedEnvironment,
    paymentAvailable: expectedProvider !== 'unavailable',
    provider: expectedProvider,
    chapaEnabled: expectedProvider === 'chapa',
  });
}

test('checkout config exposes only public fields with Stripe and database sentinels configured', () => {
  const sentinels = [
    'sk_test_STRIPE_SECRET_SENTINEL',
    'whsec_STRIPE_WEBHOOK_SENTINEL',
    'CHASECK_CHAPA_SECRET_SENTINEL',
    'CHAWEBHOOK_CHAPA_SECRET_SENTINEL',
    'DATABASE_USER_SENTINEL',
    'DATABASE_PASSWORD_SENTINEL',
    'postgresql://DATABASE_USER_SENTINEL:DATABASE_PASSWORD_SENTINEL@db.example.test/savora',
  ];
  const serializedResponse = getSerializedResponse({
    nodeEnv: 'development',
    paymentProvider: 'stripe',
    stripeSecretKey: sentinels[0],
    stripeWebhookSecret: sentinels[1],
    chapaSecretKey: sentinels[2],
    chapaWebhookSecret: sentinels[3],
    databaseUrl: sentinels[6],
    etbPricesApproved: false,
  });

  assertPublicResponseShape(serializedResponse, 'stripe', 'test');
  for (const sentinel of sentinels) {
    assert.equal(serializedResponse.includes(sentinel), false);
  }
});

test('checkout config exposes only public fields with Chapa and database sentinels configured', () => {
  const sentinels = [
    'sk_test_STRIPE_SECRET_SENTINEL',
    'whsec_STRIPE_WEBHOOK_SENTINEL',
    'CHASECK_CHAPA_SECRET_SENTINEL',
    'CHAWEBHOOK_CHAPA_SECRET_SENTINEL',
    'DATABASE_USER_SENTINEL',
    'DATABASE_PASSWORD_SENTINEL',
    'postgresql://DATABASE_USER_SENTINEL:DATABASE_PASSWORD_SENTINEL@db.example.test/savora',
  ];
  const serializedResponse = getSerializedResponse({
    nodeEnv: 'development',
    paymentProvider: 'chapa',
    chapaEnvironment: 'test',
    stripeSecretKey: sentinels[0],
    stripeWebhookSecret: sentinels[1],
    chapaSecretKey: sentinels[2],
    chapaWebhookSecret: sentinels[3],
    databaseUrl: sentinels[6],
    etbPricesApproved: false,
  });

  assertPublicResponseShape(serializedResponse, 'chapa', 'test');
  for (const sentinel of sentinels) {
    assert.equal(serializedResponse.includes(sentinel), false);
  }
});

test('checkout config safely represents missing or invalid payment configuration', () => {
  const cases = [
    {
      name: 'Stripe key missing in production',
      config: {
        nodeEnv: 'production',
        paymentProvider: 'stripe',
        stripeSecretKey: '',
        etbPricesApproved: false,
      },
      provider: 'unavailable',
      environment: null,
    },
    {
      name: 'Chapa placeholder key in production',
      config: {
        nodeEnv: 'production',
        paymentProvider: 'chapa',
        chapaEnvironment: 'live',
        chapaSecretKey: 'CHAPA_PLACEHOLDER_SENTINEL',
        etbPricesApproved: false,
      },
      provider: 'unavailable',
      environment: null,
    },
    {
      name: 'Stripe key without a recognized mode prefix',
      config: {
        nodeEnv: 'development',
        paymentProvider: 'stripe',
        stripeSecretKey: 'STRIPE_INVALID_FORMAT_SENTINEL',
        etbPricesApproved: false,
      },
      provider: 'stripe',
      environment: null,
    },
  ];

  for (const { name, config, provider, environment } of cases) {
    const serializedResponse = getSerializedResponse(config);
    assertPublicResponseShape(serializedResponse, provider, environment);
    assert.equal(serializedResponse.includes('SENTINEL'), false, name);
  }
});

test('checkout config returns paymentAvailable: true and provider: chapa when CHAPA_SECRET_KEY is configured in production', () => {
  const serializedResponse = getSerializedResponse({
    nodeEnv: 'production',
    paymentProvider: 'chapa',
    chapaEnvironment: 'test',
    chapaSecretKey: 'CHASECK_TEST-actual-valid-key-value',
    etbPricesApproved: true,
  });

  const parsed = JSON.parse(serializedResponse);
  assert.equal(parsed.paymentProvider, 'chapa');
  assert.equal(parsed.provider, 'chapa');
  assert.equal(parsed.paymentAvailable, true);
  assert.equal(parsed.chapaEnabled, true);
  assert.equal(parsed.paymentEnvironment, 'test');
});
