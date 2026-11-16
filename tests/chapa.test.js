import test from 'node:test';
import assert from 'node:assert/strict';

import {
  initializeChapaTransaction,
  processChapaWebhook,
  resolvePaymentProvider,
  verifyAndApplyChapaPayment,
} from '../src/services/chapa.js';
import { calculateCheckoutTotals, minorUnitsToDecimal } from '../src/lib/money.js';

const txRef = 'SAV-20261013000000-ABCDE';
const webhookSecret = 'test-webhook-secret';

function createMemoryPrisma({ rejectOrderUpdate = false } = {}) {
  const state = {
    payment: {
      orderId: 'order-1',
      provider: 'CHAPA',
      status: 'PENDING',
      amount: 12.34,
      transactionId: txRef,
    },
    order: { id: 'order-1', status: 'PENDING' },
  };

  const tx = {
    payment: {
      updateMany: async ({ where, data }) => {
        if (
          state.payment.orderId === where.orderId
          && state.payment.provider === where.provider
          && state.payment.transactionId === where.transactionId
          && state.payment.status === where.status
        ) {
          Object.assign(state.payment, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
      findUnique: async () => state.payment,
    },
    order: {
      updateMany: async ({ where, data }) => {
        if (
          !rejectOrderUpdate
          && state.order.id === where.id
          && state.order.status === where.status
        ) {
          Object.assign(state.order, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
      findUnique: async () => state.order,
    },
  };

  return {
    state,
    payment: {
      findFirst: async () => ({ ...state.payment, order: state.order }),
    },
    $transaction: (callback) => callback(tx),
  };
}

function successfulVerifyResponse(overrides = {}) {
  return {
    status: 'success',
    data: {
      status: 'success',
      tx_ref: txRef,
      amount: '12.34',
      currency: 'ETB',
      ...overrides,
    },
  };
}

function webhookPayload() {
  return Buffer.from(JSON.stringify({ event: 'charge.success', data: { tx_ref: txRef } }));
}

function webhookHeaders() {
  return { 'x-chapa-signature': webhookSecret };
}

test('marks an order paid only after successful Chapa verification', async () => {
  const prisma = createMemoryPrisma();
  const result = await verifyAndApplyChapaPayment({
    prisma,
    txRef,
    secretKey: 'CHASECK-test1234567890',
    currency: 'ETB',
    fetchImpl: async (url, options) => {
      assert.equal(url, `https://api.chapa.co/v1/transaction/verify/${txRef}`);
      assert.equal(options.headers.Authorization, 'Bearer CHASECK-test1234567890');
      return { ok: true, json: async () => successfulVerifyResponse() };
    },
  });

  assert.equal(result.paymentStatus, 'PAID');
  assert.equal(prisma.state.payment.status, 'PAID');
  assert.equal(prisma.state.order.status, 'CONFIRMED');
});

test('leaves an order pending when Chapa verification fails', async () => {
  const prisma = createMemoryPrisma();
  const result = await verifyAndApplyChapaPayment({
    prisma,
    txRef,
    secretKey: 'CHASECK-test1234567890',
    currency: 'ETB',
    fetchImpl: async () => ({
      ok: true,
      json: async () => successfulVerifyResponse({ status: 'failed' }),
    }),
  });

  assert.equal(result.paymentStatus, 'PENDING');
  assert.equal(result.verified, false);
  assert.equal(prisma.state.payment.status, 'PENDING');
  assert.equal(prisma.state.order.status, 'PENDING');
});

test('does not report a confirmed order when the conditional update affects no row', async () => {
  const prisma = createMemoryPrisma({ rejectOrderUpdate: true });
  const result = await verifyAndApplyChapaPayment({
    prisma,
    txRef,
    secretKey: 'CHASECK-test1234567890',
    currency: 'ETB',
    fetchImpl: async () => ({
      ok: true,
      json: async () => successfulVerifyResponse(),
    }),
  });

  assert.equal(result.paymentStatus, 'PAID');
  assert.equal(result.orderStatus, 'PENDING');
  assert.equal(prisma.state.order.status, 'PENDING');
});

test('a previously paid transaction reports the persisted order status', async () => {
  const prisma = createMemoryPrisma({ rejectOrderUpdate: true });
  prisma.state.payment.status = 'PAID';
  prisma.state.order.status = 'PENDING';

  const result = await verifyAndApplyChapaPayment({
    prisma,
    txRef,
    secretKey: 'CHASECK-test1234567890',
    currency: 'ETB',
  });

  assert.equal(result.paymentStatus, 'PAID');
  assert.equal(result.orderStatus, 'PENDING');
  assert.equal(prisma.state.order.status, 'PENDING');
});

test('acknowledges repeated authenticated callbacks without applying payment twice', async () => {
  const prisma = createMemoryPrisma();
  let verifyCalls = 0;
  const webhookOptions = {
    rawBody: webhookPayload(),
    headers: webhookHeaders(),
    webhookSecret,
    prisma,
    secretKey: 'CHASECK-test1234567890',
    currency: 'ETB',
    fetchImpl: async () => {
      verifyCalls += 1;
      return { ok: true, json: async () => successfulVerifyResponse() };
    },
  };

  const first = await processChapaWebhook(webhookOptions);
  const repeated = await processChapaWebhook(webhookOptions);

  assert.equal(first.statusCode, 200);
  assert.deepEqual(repeated, first);
  assert.equal(verifyCalls, 1);
  assert.equal(prisma.state.payment.status, 'PAID');
  assert.equal(prisma.state.order.status, 'CONFIRMED');
});

test('uses demo mode when the Chapa secret key is missing', () => {
  for (const chapaSecretKey of ['', undefined]) {
    const provider = resolvePaymentProvider({
      paymentProvider: 'chapa',
      nodeEnv: 'development',
      chapaEnvironment: 'test',
      chapaSecretKey,
    });

    assert.equal(provider, 'demo');
  }
});

test('enables Chapa in development with a non-empty test key without a required prefix', () => {
  const provider = resolvePaymentProvider({
    paymentProvider: 'chapa',
    nodeEnv: 'development',
    chapaEnvironment: 'test',
    chapaSecretKey: 'active-test-key-from-dashboard',
  });

  assert.equal(provider, 'chapa');
});

test('initializes Chapa with the exact ETB amount calculated in minor units', async () => {
  const totals = calculateCheckoutTotals(55000, 'delivery');
  const amount = minorUnitsToDecimal(totals.totalMinorUnits);
  let requestBody;
  const result = await initializeChapaTransaction({
    secretKey: 'non-empty-test-key',
    amount,
    currency: 'ETB',
    email: 'test@example.com',
    customerName: 'Test Customer',
    txRef: 'SAV-ETB-TEST-001',
    returnUrl: 'https://example.test/return',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          data: { checkout_url: 'https://checkout.chapa.co/checkout/payment/test' },
        }),
      };
    },
  });

  assert.equal(amount, '694.00');
  assert.equal(requestBody.amount, amount);
  assert.equal(requestBody.currency, 'ETB');
  assert.equal(result.checkoutUrl, 'https://checkout.chapa.co/checkout/payment/test');
});

test('resolves Chapa when valid keys are configured in development and production', () => {
  const chapaConfiguredInDevelopment = resolvePaymentProvider({
    paymentProvider: 'chapa',
    nodeEnv: 'development',
    chapaEnvironment: 'test',
    chapaSecretKey: 'active-test-key-from-dashboard',
  });
  const liveInProduction = resolvePaymentProvider({
    paymentProvider: 'chapa',
    nodeEnv: 'production',
    chapaEnvironment: 'live',
    chapaSecretKey: 'active-live-key-from-dashboard',
  });
  const testInProduction = resolvePaymentProvider({
    paymentProvider: 'chapa',
    nodeEnv: 'production',
    chapaEnvironment: 'test',
    chapaSecretKey: 'CHASECK_TEST-active-test-key-from-dashboard',
  });
  const missingInProduction = resolvePaymentProvider({
    paymentProvider: 'chapa',
    nodeEnv: 'production',
    chapaSecretKey: '',
  });

  assert.equal(chapaConfiguredInDevelopment, 'chapa');
  assert.equal(liveInProduction, 'chapa');
  assert.equal(testInProduction, 'chapa');
  assert.equal(missingInProduction, 'unavailable');
});

test('keeps Stripe and explicit demo provider resolution unchanged', () => {
  assert.equal(resolvePaymentProvider({
    paymentProvider: 'stripe',
    nodeEnv: 'development',
    stripeSecretKey: 'stripe-test-secret',
  }), 'stripe');
  assert.equal(resolvePaymentProvider({
    paymentProvider: 'demo',
    nodeEnv: 'development',
  }), 'demo');
});

test('initializes checkout with the official Chapa transaction endpoint', async () => {
  const totals = calculateCheckoutTotals(4950, 'delivery');
  const result = await initializeChapaTransaction({
    secretKey: 'active-test-key-from-dashboard',
    amount: minorUnitsToDecimal(totals.totalMinorUnits),
    currency: 'ETB',
    email: 'guest@example.com',
    customerName: 'Alex Morgan',
    phone: '',
    txRef,
    returnUrl: 'https://savora.example/checkout.html',
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.chapa.co/v1/transaction/initialize');
      const body = JSON.parse(options.body);
      assert.equal(body.tx_ref, txRef);
      assert.equal(body.first_name, 'Alex');
      assert.equal(body.last_name, 'Morgan');
      assert.equal(body.amount, '153.46');
      assert.equal(body.currency, 'ETB');
      return {
        ok: true,
        json: async () => ({
          status: 'success',
          data: { checkout_url: 'https://checkout.chapa.co/checkout/payment/test' },
        }),
      };
    },
  });

  assert.equal(result.checkoutUrl, 'https://checkout.chapa.co/checkout/payment/test');
});
