import test from 'node:test';
import assert from 'node:assert/strict';

import {
  capCartQuantity,
  cartRoutes,
  incrementCartItemQuantity,
  resolveCart,
} from '../src/routes/cartRoutes.js';
import {
  InvalidCartQuantityError,
  loadCartForOrder,
  MissingCartIdentityError,
  orderRoutes,
} from '../src/routes/orderRoutes.js';
import { extractGuestSessionId } from '../src/lib/cartIdentity.js';
import { extractAuthToken, createOptionalAuth } from '../src/middleware/auth.js';

function routeHandler(router, path, method) {
  const layer = router.stack.find((entry) => (
    entry.route?.path === path && entry.route.methods[method]
  ));
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function createResponse() {
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

test('checkout endpoints return a client error when a guest session is missing', async () => {
  for (const path of ['/checkout', '/checkout-session']) {
    const response = createResponse();
    await routeHandler(orderRoutes, path, 'post')({
      body: {},
      headers: {},
    }, response);
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.body, {
      error: 'A guest session identifier is required.',
    });
  }
});

test('guest cart endpoint returns a client error when a session is missing', async () => {
  const response = createResponse();
  await routeHandler(cartRoutes, '/', 'get')({
    headers: {},
    query: {},
  }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    error: 'A guest session identifier is required.',
  });
});

test('cart ID lookups are restricted to the authenticated user', async () => {
  let lookup;
  const result = await loadCartForOrder({
    cartId: 'another-users-cart',
    userId: 'current-user',
    database: {
      shoppingCart: {
        findFirst: async (query) => {
          lookup = query;
          return null;
        },
      },
    },
  });

  assert.deepEqual(lookup.where, {
    id: 'another-users-cart',
    userId: 'current-user',
  });
  assert.equal(result.cart, null);
  assert.deepEqual(result.orderItems, []);
});

test('guest cart ID lookups are restricted to the current session', async () => {
  let lookup;
  const result = await loadCartForOrder({
    cartId: 'another-sessions-cart',
    sessionId: 'current-session',
    database: {
      shoppingCart: {
        findFirst: async (query) => {
          lookup = query;
          return null;
        },
      },
    },
  });

  assert.deepEqual(lookup.where, {
    id: 'another-sessions-cart',
    sessionId: 'current-session',
  });
  assert.equal(result.cart, null);
});

test('checkout without a guest session is rejected before cart lookup', async () => {
  let lookupCalled = false;
  await assert.rejects(loadCartForOrder({
    database: {
      shoppingCart: {
        findFirst: async () => {
          lookupCalled = true;
          return null;
        },
      },
    },
  }), MissingCartIdentityError);

  assert.equal(lookupCalled, false);
});

test('valid guest checkout loads only the cart belonging to the supplied session', async () => {
  let lookup;
  const cart = {
    id: 'guest-cart',
    items: [{
      quantity: 2,
      productId: 'product-1',
      product: {
        id: 'product-1',
        slug: 'the-savora-stack',
        isActive: true,
      },
    }],
  };
  const result = await loadCartForOrder({
    sessionId: ' guest-session-123 ',
    database: {
      shoppingCart: {
        findFirst: async (query) => {
          lookup = query;
          return cart;
        },
      },
    },
  });

  assert.deepEqual(lookup.where, { sessionId: 'guest-session-123' });
  assert.equal(result.cart, cart);
  assert.equal(result.orderItems[0].quantity, 2);
  assert.equal(result.subtotalMinorUnits, 110000);
});

test('guest cart resolution requires and scopes to a non-empty session ID', async () => {
  let lookupCalled = false;
  const database = {
    shoppingCart: {
      findFirst: async (query) => {
        lookupCalled = true;
        assert.deepEqual(query.where, { sessionId: 'session-a' });
        return { id: 'cart-a', items: [] };
      },
      create: async () => {
        throw new Error('An existing guest cart should be returned.');
      },
    },
  };

  assert.equal(await resolveCart(null, '   ', database), null);
  assert.equal(lookupCalled, false);
  const cart = await resolveCart(null, ' session-a ', database);
  assert.equal(cart.id, 'cart-a');
  assert.equal(lookupCalled, true);
});

function createConcurrentCartDatabase(initialQuantity) {
  const state = { item: initialQuantity === null ? null : { quantity: initialQuantity } };
  return {
    state,
    $transaction: async (callback) => callback({
      cartItem: {
        upsert: async ({ create, update }) => {
          if (!state.item) {
            state.item = { ...create };
          } else {
            Object.assign(state.item, update);
          }
          return state.item;
        },
        updateMany: async ({ where, data }) => {
          const item = state.item;
          if (!item) return { count: 0 };
          const quantityFilter = where.quantity;
          if (
            (quantityFilter.lte !== undefined && item.quantity > quantityFilter.lte)
            || (quantityFilter.lt !== undefined && item.quantity >= quantityFilter.lt)
          ) {
            return { count: 0 };
          }
          item.quantity += data.quantity.increment;
          Object.assign(item, { unitPrice: data.unitPrice });
          return { count: 1 };
        },
        findUnique: async () => state.item,
      },
    }),
  };
}

test('concurrent atomic increments preserve additions and cap quantity at 99', async () => {
  const newCart = createConcurrentCartDatabase(null);
  await incrementCartItemQuantity({
    database: newCart,
    cartId: 'cart-1',
    productId: 'product-1',
    addedQuantity: 120,
    unitPrice: '5.50',
  });
  assert.equal(newCart.state.item.quantity, 99);

  const belowCap = createConcurrentCartDatabase(10);
  await Promise.all(Array.from({ length: 2 }, () => incrementCartItemQuantity({
    database: belowCap,
    cartId: 'cart-1',
    productId: 'product-1',
    addedQuantity: 3,
    unitPrice: '5.50',
  })));
  assert.equal(belowCap.state.item.quantity, 16);

  const nearCap = createConcurrentCartDatabase(80);
  await Promise.all(Array.from({ length: 2 }, () => incrementCartItemQuantity({
    database: nearCap,
    cartId: 'cart-1',
    productId: 'product-1',
    addedQuantity: 15,
    unitPrice: '5.50',
  })));
  assert.equal(nearCap.state.item.quantity, 99);
});

test('rejects stored checkout quantities outside the range 1 through 99', async () => {
  for (const quantity of [0, -1, 1.5, 100]) {
    await assert.rejects(
      loadCartForOrder({
        cartId: 'owned-cart',
        userId: 'current-user',
        database: {
          shoppingCart: {
            findFirst: async () => ({
              items: [{
                quantity,
                productId: 'product-1',
                product: {
                  id: 'product-1',
                  slug: 'the-savora-stack',
                  isActive: true,
                },
              }],
            }),
          },
        },
      }),
      InvalidCartQuantityError,
    );
  }
});

test('caps an existing cart item at 99 when adding more quantity', () => {
  assert.equal(capCartQuantity(98, 5), 99);
  assert.equal(capCartQuantity(99, 1), 99);
});

test('extractGuestSessionId resolves from headers, body, query, and cookies', () => {
  assert.equal(extractGuestSessionId({ headers: { 'x-session-id': 'sess-header' } }), 'sess-header');
  assert.equal(extractGuestSessionId({ headers: { 'X-Session-Id': 'sess-cap-header' } }), 'sess-cap-header');
  assert.equal(extractGuestSessionId({ body: { sessionId: 'sess-body' } }), 'sess-body');
  assert.equal(extractGuestSessionId({ query: { sessionId: 'sess-query' } }), 'sess-query');
  assert.equal(extractGuestSessionId({ headers: { cookie: 'savora_session_id=sess-cookie; other=1' } }), 'sess-cookie');
  assert.equal(extractGuestSessionId({ headers: { cookie: 'session_id=sess-short-cookie' } }), 'sess-short-cookie');
  assert.equal(extractGuestSessionId({ headers: {}, query: {} }), null);
});

test('extractAuthToken resolves from Authorization Bearer and savora_token cookie', () => {
  assert.equal(extractAuthToken({ headers: { authorization: 'Bearer test-jwt-token' } }), 'test-jwt-token');
  assert.equal(extractAuthToken({ headers: { cookie: 'savora_token=test-cookie-jwt' } }), 'test-cookie-jwt');
  assert.equal(extractAuthToken({ headers: { cookie: 'token=test-short-jwt' } }), 'test-short-jwt');
  assert.equal(extractAuthToken({ headers: {} }), null);
});

test('optionalAuth middleware leaves req.user null and continues for unauthenticated guest', async () => {
  const optionalAuth = createOptionalAuth();
  const req = { headers: {} };
  const res = createResponse();
  let nextCalled = false;
  await optionalAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user, null);
  assert.equal(res.statusCode, 200);
});
