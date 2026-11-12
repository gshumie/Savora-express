import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOrderStatusToken,
  isValidOrderStatusToken,
} from '../src/lib/orderStatusToken.js';
import { createPaymentStatusHandler } from '../src/services/paymentStatus.js';

const secret = 'test-payment-status-signing-key-with-sufficient-length';
const orderNumber = 'SAV-20261018010000-0123456789ABCDEF0123456789ABCDEF';

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

test('payment status tokens are order-bound and invalid tokens are rejected', () => {
  const token = createOrderStatusToken(orderNumber, secret);

  assert.equal(isValidOrderStatusToken(token, orderNumber, secret), true);
  assert.equal(isValidOrderStatusToken(token, 'another-order', secret), false);
  assert.equal(isValidOrderStatusToken(token, orderNumber, 'a-different-signing-secret'), false);
  assert.equal(isValidOrderStatusToken('', orderNumber, secret), false);
});

test('payment status request is unauthorized without a valid order token', async () => {
  let databaseLookups = 0;
  const handler = createPaymentStatusHandler({
    config: { paymentStatusTokenSecret: secret },
    prisma: { order: { findUnique: async () => { databaseLookups += 1; } } },
  });
  const response = makeResponse();

  await handler({ body: { orderNumber, token: 'invalid-token' } }, response);

  assert.equal(response.statusCode, 401);
  assert.equal(databaseLookups, 0);
});

test('valid order token grants access to only the persisted order/payment status', async () => {
  const token = createOrderStatusToken(orderNumber, secret);
  const response = makeResponse();
  const handler = createPaymentStatusHandler({
    config: { paymentStatusTokenSecret: secret },
    prisma: {
      order: {
        findUnique: async ({ where }) => {
          assert.deepEqual(where, { orderNumber });
          return {
            status: 'CONFIRMED',
            payment: { status: 'PAID', provider: 'STRIPE' },
          };
        },
      },
    },
  });

  await handler({ body: { orderNumber, token } }, response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { orderStatus: 'CONFIRMED', paymentStatus: 'PAID' });
});
