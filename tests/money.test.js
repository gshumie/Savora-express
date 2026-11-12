import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENCY,
  DELIVERY_FEE_MINOR_UNITS,
  calculateCartSubtotalMinorUnits,
  calculateCheckoutTotals,
  calculateTaxMinorUnits,
  formatMinorUnits,
  minorUnitsToDecimal,
  toMinorUnits,
} from '../src/lib/money.js';
import { requireEtbPriceApproval } from '../src/middleware/pricingApproval.js';
import { APPROVED_ETB_PRICES } from '../src/lib/approvedPrices.js';

test('formats monetary values as Ethiopian Birr (ETB)', () => {
  assert.equal(CURRENCY, 'ETB');
  assert.equal(formatMinorUnits(1550).replace(/\u00a0/g, ' '), 'ETB 15.50');
  assert.equal(minorUnitsToDecimal(1550), '15.50');
});

test('parses existing decimal prices into integer minor units without float arithmetic', () => {
  assert.equal(toMinorUnits('15.50'), 1550);
  assert.equal(toMinorUnits(3.99), 399);
  assert.equal(calculateCartSubtotalMinorUnits([
    { unitPrice: '15.50', quantity: 3 },
    { unitPrice: '3.99', quantity: 2 },
  ]), 5448);
});

test('rounds 8 percent tax in minor units and applies delivery or free pickup consistently', () => {
  assert.equal(DELIVERY_FEE_MINOR_UNITS, 10000);
  assert.equal(calculateTaxMinorUnits(4950), 396);
  assert.equal(calculateTaxMinorUnits(7), 1);
  assert.deepEqual(calculateCheckoutTotals(4950, 'delivery'), {
    subtotalMinorUnits: 4950,
    taxMinorUnits: 396,
    deliveryFeeMinorUnits: 10000,
    totalMinorUnits: 15346,
  });

  test('defines exactly the twelve owner-approved ETB catalog prices', () => {
    assert.deepEqual(APPROVED_ETB_PRICES, {
      'calabrian-heat': 650,
      'creamy-tuscan-chicken-pasta': 580,
      'crispy-buttermilk-chicken': 520,
      'fresh-mint-lemonade': 150,
      'garden-margherita': 550,
      'house-tiramisu': 280,
      'lemon-herb-roast-chicken': 680,
      'smoky-bbq-chicken-burger': 480,
      'strawberry-basil-cooler': 180,
      'sunday-pappardelle': 620,
      'the-savora-stack': 550,
      'warm-chocolate-brownie': 220,
    });
  });
  assert.deepEqual(calculateCheckoutTotals(4950, 'pickup'), {
    subtotalMinorUnits: 4950,
    taxMinorUnits: 396,
    deliveryFeeMinorUnits: 0,
    totalMinorUnits: 5346,
  });
});

test('rejects monetary values that cannot safely be represented to two decimals', () => {
  assert.throws(() => toMinorUnits('15.501'), RangeError);
  assert.throws(() => toMinorUnits('-1.00'), RangeError);
});

test('unapproved ETB prices block checkout before order or payment handlers run', async () => {
  const express = (await import('express')).default;
  for (const pricesApproved of [false, undefined]) {
    const app = express();
    app.post(
      '/checkout',
      requireEtbPriceApproval({ etbPricesApproved: pricesApproved }),
      (_req, res) => res.status(201).json({ orderCreated: true }),
    );
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise((resolve, reject) => {
        server.once('listening', resolve);
        server.once('error', reject);
      });
      const response = await fetch(`http://127.0.0.1:${server.address().port}/checkout`, { method: 'POST' });
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        error: 'Checkout is disabled until ETB prices are approved.',
      });
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }
});

test('approved ETB prices allow the checkout handler to proceed', async () => {
  const express = (await import('express')).default;
  const app = express();
  app.post(
    '/checkout',
    requireEtbPriceApproval({ etbPricesApproved: true }),
    (_req, res) => res.status(201).json({ orderCreated: true }),
  );
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/checkout`, { method: 'POST' });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { orderCreated: true });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
