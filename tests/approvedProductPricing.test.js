import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_ETB_PRICES } from '../src/lib/approvedPrices.js';
import {
  applyApprovedEtbPrices,
  getApprovedEtbPrice,
  UnapprovedProductPricingError,
} from '../src/lib/approvedProductPricing.js';

test('resolves all twelve approved prices by exact stable slug', () => {
  for (const [slug, price] of Object.entries(APPROVED_ETB_PRICES)) {
    assert.equal(getApprovedEtbPrice({ slug }), price);
  }
  assert.equal(Object.keys(APPROVED_ETB_PRICES).length, 12);
});

test('replaces a mismatched database price with its approved ETB price', () => {
  const [slug, approvedPrice] = Object.entries(APPROVED_ETB_PRICES)[0];
  const [product] = applyApprovedEtbPrices([{ id: 'db-id', slug, price: 0.01 }]);

  assert.equal(product.price, approvedPrice);
});

test('rejects products outside the approved catalog', () => {
  assert.throws(
    () => getApprovedEtbPrice({ slug: 'unapproved-product' }),
    UnapprovedProductPricingError,
  );
});

test('rejects products without a stable pricing identifier', () => {
  assert.throws(() => getApprovedEtbPrice({ id: 'db-id', name: 'Calabrian Heat' }), UnapprovedProductPricingError);
  assert.throws(() => getApprovedEtbPrice({ slug: '' }), UnapprovedProductPricingError);
});

test('rejects duplicate slugs as ambiguous identifiers', () => {
  const product = { slug: 'calabrian-heat' };
  assert.throws(
    () => applyApprovedEtbPrices([product, { ...product, id: 'duplicate' }]),
    UnapprovedProductPricingError,
  );
});
