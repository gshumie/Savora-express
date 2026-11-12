import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePersistedCart,
  serializePersistedCart,
} from '../src/lib/cartPersistence.js';

test('migrates known legacy IDs and current slugs to current database product IDs', () => {
  const products = [
    { id: 'db-margherita', slug: 'garden-margherita' },
    { id: 'db-stack', slug: 'the-savora-stack' },
    { id: 'db-pappardelle', slug: 'sunday-pappardelle' },
  ];

  const migrated = normalizePersistedCart({
    margherita: 2,
    'garden-margherita': 3,
    'savora-burger': 1,
    pappardelle: 4,
  }, products);

  assert.deepEqual(migrated, {
    cart: {
      'db-margherita': 5,
      'db-stack': 1,
      'db-pappardelle': 4,
    },
    removedCount: 0,
  });
});

test('retains stable-slug carts across fallback and API ID changes', () => {
  const fallbackProducts = [{ id: 'the-savora-stack', slug: 'the-savora-stack' }];
  const apiProducts = [{ id: 'db-product-id', slug: 'the-savora-stack' }];
  const persisted = serializePersistedCart({ 'the-savora-stack': 2 }, fallbackProducts);

  assert.deepEqual(persisted, { 'the-savora-stack': 2 });
  assert.deepEqual(normalizePersistedCart(persisted, apiProducts), {
    cart: { 'db-product-id': 2 },
    removedCount: 0,
  });
});

test('counts unmatched and invalid saved cart entries for a user-visible reset notice', () => {
  const result = normalizePersistedCart({
    'database-id-from-unavailable-catalog': 2,
    'removed-product': 1,
    'the-savora-stack': 0,
  }, [{ id: 'the-savora-stack', slug: 'the-savora-stack' }]);

  assert.deepEqual(result, {
    cart: {},
    removedCount: 3,
  });
});

test('serializes cart item identifiers as stable slugs', () => {
  assert.deepEqual(
    serializePersistedCart(
      { 'db-product-id': 2 },
      [{ id: 'db-product-id', slug: 'the-savora-stack' }],
    ),
    { 'the-savora-stack': 2 },
  );
});

test('serializes only known products with integer quantities from 1 through 99', () => {
  assert.deepEqual(
    serializePersistedCart({
      'db-one': 1,
      'db-ninety-nine': 99,
      'db-zero': 0,
      'db-negative': -1,
      'db-fraction': 1.5,
      'db-too-many': 100,
      'db-string': '2',
      'db-null': null,
      'unknown-product': 2,
    }, [
      { id: 'db-one', slug: 'product-one' },
      { id: 'db-ninety-nine', slug: 'product-ninety-nine' },
      { id: 'db-zero', slug: 'product-zero' },
      { id: 'db-negative', slug: 'product-negative' },
      { id: 'db-fraction', slug: 'product-fraction' },
      { id: 'db-too-many', slug: 'product-too-many' },
      { id: 'db-string', slug: 'product-string' },
      { id: 'db-null', slug: 'product-null' },
    ]),
    {
      'product-one': 1,
      'product-ninety-nine': 99,
    },
  );
});

test('caps merged legacy and current identifiers at 99 per product', () => {
  assert.deepEqual(
    normalizePersistedCart({
      margherita: 50,
      'garden-margherita': 49,
      'db-margherita': 1,
    }, [{ id: 'db-margherita', slug: 'garden-margherita' }]),
    {
      cart: { 'db-margherita': 99 },
      removedCount: 0,
    },
  );
});
