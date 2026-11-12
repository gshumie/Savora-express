import test from 'node:test';
import assert from 'node:assert/strict';

import { initializePaymentProvider } from '../src/services/paymentInitialization.js';

function createPendingOrderPrisma() {
  const state = {
    payment: { orderId: 'order-1', provider: '', status: 'PENDING' },
    order: { id: 'order-1', status: 'PENDING' },
  };
  return {
    state,
    $transaction: (callback) => callback({
      payment: {
        updateMany: async ({ where, data }) => {
          if (
            where.orderId === state.payment.orderId
            && where.provider === state.payment.provider
            && where.status === state.payment.status
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
          if (where.id === state.order.id && where.status === state.order.status) {
            Object.assign(state.order, data);
            return { count: 1 };
          }
          return { count: 0 };
        },
      },
    }),
  };
}

for (const provider of ['CHAPA', 'STRIPE']) {
  test(`${provider} initialization failure marks the order and payment failed without confirming them`, async () => {
    const prisma = createPendingOrderPrisma();
    prisma.state.payment.provider = provider;

    await assert.rejects(
      initializePaymentProvider({
        prisma,
        orderId: 'order-1',
        provider,
        initialize: async () => {
          throw new Error('provider initialization failed');
        },
      }),
      /provider initialization failed/,
    );

    assert.equal(prisma.state.payment.status, 'FAILED');
    assert.equal(prisma.state.order.status, 'CANCELLED');
    assert.notEqual(prisma.state.payment.status, 'PAID');
    assert.notEqual(prisma.state.order.status, 'CONFIRMED');
  });
}

test('does not cancel an order if a payment callback already marked its payment paid', async () => {
  const prisma = createPendingOrderPrisma();
  prisma.state.payment.provider = 'STRIPE';
  prisma.state.payment.status = 'PAID';
  prisma.state.order.status = 'CONFIRMED';

  await assert.rejects(
    initializePaymentProvider({
      prisma,
      orderId: 'order-1',
      provider: 'STRIPE',
      initialize: async () => {
        throw new Error('provider initialization response failed');
      },
    }),
    /provider initialization response failed/,
  );

  assert.equal(prisma.state.payment.status, 'PAID');
  assert.equal(prisma.state.order.status, 'CONFIRMED');
});
