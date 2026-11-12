import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateCurrencyCode,
  validatePaymentConfiguration,
} from '../src/lib/paymentConfiguration.js';
import { CURRENCY as CHAPA_CURRENCY } from '../src/lib/money.js';
import { assertDatabaseSeedingAllowed } from '../src/lib/seedGuard.js';
import { createStripeWebhookHandler } from '../src/services/stripeWebhook.js';

function makeResponse() {
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

function paidCheckoutEvent(sessionOverrides = {}) {
  return {
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_session',
        payment_status: 'paid',
        amount_total: 11200,
        currency: 'etb',
        metadata: { orderId: 'order-1' },
        ...sessionOverrides,
      },
    },
  };
}

function createPendingPaymentPrisma({
  rejectPaymentUpdate = false,
  paymentOverrides = {},
  orderOverrides = {},
} = {}) {
  const state = {
    order: { id: 'order-1', total: '112.00', status: 'PENDING', ...orderOverrides },
    payment: {
      orderId: 'order-1',
      provider: 'STRIPE',
      status: 'PENDING',
      transactionId: 'cs_test_session',
      amount: '112.00',
      ...paymentOverrides,
    },
  };
  state.payment.order = state.order;
  const tx = {
    payment: {
      updateMany: async ({ where, data }) => {
        if (rejectPaymentUpdate) {
          return { count: 0 };
        }
        if (
          state.payment.orderId === where.orderId
          && state.payment.provider === where.provider
          && state.payment.status === where.status
          && state.payment.transactionId === where.transactionId
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
        if (state.order.id === where.id && state.order.status === where.status) {
          Object.assign(state.order, data);
          return { count: 1 };
        }
        return { count: 0 };
      },
      findUnique: async () => state.order,
    },
  };

  return { state, $transaction: (callback) => callback(tx) };
}

async function invokeWebhook({ config, prisma, stripe }) {
  const response = makeResponse();
  await createStripeWebhookHandler({ config, prisma, stripe })({
    body: Buffer.from('{}'),
    headers: { 'stripe-signature': 'test-signature' },
  }, response);
  return response;
}

test('rejects Stripe configuration without a webhook secret', () => {
  assert.throws(
    () => validatePaymentConfiguration({ paymentProvider: 'stripe', stripeWebhookSecret: ' ' }),
    /STRIPE_WEBHOOK_SECRET must be configured/,
  );
  assert.doesNotThrow(
    () => validatePaymentConfiguration({ paymentProvider: 'chapa', stripeWebhookSecret: '' }),
  );
  assert.throws(
    () => validatePaymentConfiguration({
      paymentProvider: 'stripe',
      stripeWebhookSecret: 'configured',
      stripeCurrency: 'USD',
      catalogCurrency: 'ETB',
    }),
    /STRIPE_CURRENCY must match the ETB catalog prices/,
  );
  assert.doesNotThrow(
    () => validatePaymentConfiguration({
      paymentProvider: 'stripe',
      stripeWebhookSecret: 'configured',
      stripeCurrency: 'ETB',
      catalogCurrency: 'ETB',
    }),
  );
});

test('returns a failure instead of acknowledging events when Stripe verification is unconfigured', async () => {
  let verificationCalled = false;
  const response = await invokeWebhook({
    config: { paymentProvider: 'stripe', stripeWebhookSecret: '', stripeCurrency: 'ETB' },
    prisma: {},
    stripe: { webhooks: { constructEvent() { verificationCalled = true; } } },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(verificationCalled, false);
});

test('does not acknowledge paid events when the matching pending payment was not updated', async () => {
  const prisma = createPendingPaymentPrisma({ rejectPaymentUpdate: true });
  const response = await invokeWebhook({
    config: { paymentProvider: 'stripe', stripeWebhookSecret: 'configured', stripeCurrency: 'ETB' },
    prisma,
    stripe: { webhooks: { constructEvent: () => paidCheckoutEvent() } },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(prisma.state.payment.status, 'PENDING');
  assert.equal(prisma.state.order.status, 'PENDING');
});

test('applies a verified paid Stripe event and safely acknowledges its duplicate', async () => {
  const prisma = createPendingPaymentPrisma();
  const options = {
    config: { paymentProvider: 'stripe', stripeWebhookSecret: 'configured', stripeCurrency: 'ETB' },
    prisma,
    stripe: { webhooks: { constructEvent: () => paidCheckoutEvent() } },
  };

  const first = await invokeWebhook(options);
  const repeated = await invokeWebhook(options);

  assert.equal(first.statusCode, 200);
  assert.equal(repeated.statusCode, 200);
  assert.equal(prisma.state.payment.status, 'PAID');
  assert.equal(prisma.state.order.status, 'CONFIRMED');
});

test('repairs an order left pending when a verified paid event is retried', async () => {
  const prisma = createPendingPaymentPrisma();
  prisma.state.payment.status = 'PAID';
  const response = await invokeWebhook({
    config: { paymentProvider: 'stripe', stripeWebhookSecret: 'configured', stripeCurrency: 'ETB' },
    prisma,
    stripe: { webhooks: { constructEvent: () => paidCheckoutEvent() } },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(prisma.state.payment.status, 'PAID');
  assert.equal(prisma.state.order.status, 'CONFIRMED');
});

for (const amount of [11199, 11201, undefined]) {
  test(`rejects a Stripe paid session with amount_total ${amount === undefined ? 'missing' : amount}`, async () => {
    const prisma = createPendingPaymentPrisma();
    const response = await invokeWebhook({
      config: { paymentProvider: 'stripe', stripeWebhookSecret: 'configured', stripeCurrency: 'ETB' },
      prisma,
      stripe: {
        webhooks: {
          constructEvent: () => paidCheckoutEvent({ amount_total: amount }),
        },
      },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(prisma.state.payment.status, 'PENDING');
    assert.equal(prisma.state.order.status, 'PENDING');
  });
}

for (const currency of ['USD', undefined]) {
  test(`rejects a Stripe paid session with ${currency ? 'wrong' : 'missing'} currency`, async () => {
    const prisma = createPendingPaymentPrisma();
    const response = await invokeWebhook({
      config: { paymentProvider: 'stripe', stripeWebhookSecret: 'configured', stripeCurrency: 'ETB' },
      prisma,
      stripe: {
        webhooks: {
          constructEvent: () => paidCheckoutEvent({ currency }),
        },
      },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(prisma.state.payment.status, 'PENDING');
    assert.equal(prisma.state.order.status, 'PENDING');
  });
}

test('rejects a Stripe payment amount that differs from the persisted order total', async () => {
  const prisma = createPendingPaymentPrisma({ orderOverrides: { total: '113.00' } });
  const response = await invokeWebhook({
    config: { paymentProvider: 'stripe', stripeWebhookSecret: 'configured', stripeCurrency: 'ETB' },
    prisma,
    stripe: { webhooks: { constructEvent: () => paidCheckoutEvent() } },
  });

  assert.equal(response.statusCode, 503);
  assert.equal(prisma.state.payment.status, 'PENDING');
  assert.equal(prisma.state.order.status, 'PENDING');
});

for (const invalidIdentity of [
  { session: { id: undefined } },
  { session: { metadata: {} } },
  { session: { id: 'cs_other_session' } },
  { session: { metadata: { orderId: 'order-other' } } },
  { payment: { provider: 'CHAPA' } },
]) {
  test('rejects a Stripe event with missing or mismatched payment identity', async () => {
    const prisma = createPendingPaymentPrisma({ paymentOverrides: invalidIdentity.payment });
    const session = paidCheckoutEvent(invalidIdentity.session);
    const response = await invokeWebhook({
      config: { paymentProvider: 'stripe', stripeWebhookSecret: 'configured', stripeCurrency: 'ETB' },
      prisma,
      stripe: { webhooks: { constructEvent: () => session } },
    });

    assert.equal(response.statusCode, 503);
    assert.equal(prisma.state.payment.status, 'PENDING');
    assert.equal(prisma.state.order.status, 'PENDING');
  });
}

test('does not let a duplicate Stripe event bypass amount and currency verification', async () => {
  const prisma = createPendingPaymentPrisma();
  const event = paidCheckoutEvent();
  const options = {
    config: { paymentProvider: 'stripe', stripeWebhookSecret: 'configured', stripeCurrency: 'ETB' },
    prisma,
    stripe: { webhooks: { constructEvent: () => event } },
  };

  assert.equal((await invokeWebhook(options)).statusCode, 200);
  event.data.object.amount_total = 11199;
  event.data.object.currency = 'USD';
  assert.equal((await invokeWebhook(options)).statusCode, 503);
  assert.equal(prisma.state.payment.status, 'PAID');
  assert.equal(prisma.state.order.status, 'CONFIRMED');
});

test('validates provider currency configuration as uppercase three-letter codes', () => {
  assert.equal(validateCurrencyCode('USD', 'STRIPE_CURRENCY'), 'USD');
  assert.equal(validateCurrencyCode('ETB', 'STRIPE_CURRENCY'), 'ETB');
  assert.equal(CHAPA_CURRENCY, 'ETB');
  assert.notEqual(validateCurrencyCode('USD', 'STRIPE_CURRENCY'), CHAPA_CURRENCY);
  for (const invalid of ['usd', 'US', 'USDD', 'U$D', '', 'ZZZ', 'JPY']) {
    assert.throws(() => validateCurrencyCode(invalid, 'STRIPE_CURRENCY'));
  }
});

test('requires explicit non-production database seed opt-in', () => {
  assert.throws(() => assertDatabaseSeedingAllowed('development', false));
  assert.throws(() => assertDatabaseSeedingAllowed('production', true));
  assert.doesNotThrow(() => assertDatabaseSeedingAllowed('development', true));
});
