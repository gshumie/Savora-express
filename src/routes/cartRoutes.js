import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import {
  calculateCartSubtotalMinorUnits,
  minorUnitsToDecimal,
  toMinorUnits,
} from '../lib/money.js';
import {
  applyApprovedEtbPrices,
  getApprovedEtbPrice,
} from '../lib/approvedProductPricing.js';
import { normalizeGuestSessionId } from '../lib/cartIdentity.js';

const router = Router();

export function capCartQuantity(currentQuantity, addedQuantity) {
  return Math.min(99, currentQuantity + addedQuantity);
}

export async function resolveCart(userId, sessionId, database = prisma) {
  const normalizedSessionId = normalizeGuestSessionId(sessionId);
  if (!userId && !normalizedSessionId) {
    return null;
  }

  let cart = null;

  if (userId) {
    cart = await database.shoppingCart.findFirst({
      where: { userId },
      include: { items: { include: { product: true } } },
    });
  }

  if (!cart && !userId) {
    cart = await database.shoppingCart.findFirst({
      where: { sessionId: normalizedSessionId },
      include: { items: { include: { product: true } } },
    });
  }

  if (!cart) {
    cart = await database.shoppingCart.create({
      data: { userId: userId || null, sessionId: userId ? null : normalizedSessionId },
      include: { items: { include: { product: true } } },
    });
  }

  return cart;
}

export async function incrementCartItemQuantity({
  database = prisma,
  cartId,
  productId,
  addedQuantity,
  unitPrice,
}) {
  if (!Number.isInteger(addedQuantity) || addedQuantity < 1) {
    throw new RangeError('Added cart quantity must be a positive integer.');
  }

  const quantityToAdd = Math.min(addedQuantity, 99);
  const uniqueWhere = { cartId_productId: { cartId, productId } };

  return database.$transaction(async (tx) => {
    await tx.cartItem.upsert({
      where: uniqueWhere,
      update: { unitPrice },
      create: { cartId, productId, quantity: 0, unitPrice },
    });

    const bulkIncrement = await tx.cartItem.updateMany({
      where: {
        cartId,
        productId,
        quantity: { lte: 99 - quantityToAdd },
      },
      data: { quantity: { increment: quantityToAdd }, unitPrice },
    });

    if (bulkIncrement.count === 0) {
      for (let i = 0; i < quantityToAdd; i += 1) {
        const increment = await tx.cartItem.updateMany({
          where: { cartId, productId, quantity: { lt: 99 } },
          data: { quantity: { increment: 1 }, unitPrice },
        });
        if (increment.count === 0) {
          break;
        }
      }
    }

    return tx.cartItem.findUnique({ where: uniqueWhere });
  });
}

async function prepareCartPayload(cart) {
  const approvedProducts = applyApprovedEtbPrices(cart.items.map((item) => item.product));
  const items = cart.items.map((item, index) => {
    const product = approvedProducts[index];
    const unitPriceMinorUnits = toMinorUnits(product.price);
    const quantity = Number(item.quantity ?? 0);
    const lineTotalMinorUnits = unitPriceMinorUnits * quantity;

    return {
      id: product.id,
      productId: item.productId,
      name: product.name,
      quantity,
      unitPrice: Number(minorUnitsToDecimal(unitPriceMinorUnits)),
      lineTotal: Number(minorUnitsToDecimal(lineTotalMinorUnits)),
      image: product.image,
    };
  });
  const subtotalMinorUnits = calculateCartSubtotalMinorUnits(
    items.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity })),
  );

  return {
    id: cart.id,
    userId: cart.userId,
    sessionId: cart.sessionId,
    items,
    subtotal: Number(minorUnitsToDecimal(subtotalMinorUnits)),
    count: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}

router.get('/', async (req, res) => {
  try {
    const tokenUser = req.user || null;
    const sessionId = normalizeGuestSessionId(req.headers['x-session-id'])
      || normalizeGuestSessionId(req.query.sessionId);
    if (!tokenUser?.id && !sessionId) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }
    const cart = await resolveCart(tokenUser?.id || null, tokenUser ? null : sessionId);
    const payload = await prepareCartPayload(cart);

    return res.json({ cart: payload });
  } catch (error) {
    console.error('Get cart error:', error);
    return res.status(500).json({ error: 'Unable to load cart.' });
  }
});

router.post('/items', async (req, res) => {
  try {
    const { productId, quantity = 1, sessionId } = req.body || {};
    const userId = req.user?.id || null;
    const providedSessionId = normalizeGuestSessionId(sessionId)
      || normalizeGuestSessionId(req.headers['x-session-id']);

    if (!userId && !providedSessionId) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required.' });
    }

    const nextQuantity = Number(quantity);
    if (!Number.isInteger(nextQuantity) || nextQuantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive whole number.' });
    }

    const product = await prisma.product.findUnique({ where: { id: String(productId) } });
    if (!product || !product.isActive) {
      return res.status(404).json({ error: 'Product not found or unavailable.' });
    }
    const approvedPrice = getApprovedEtbPrice(product);

    const cart = await resolveCart(userId, userId ? null : providedSessionId);
    const item = await incrementCartItemQuantity({
      cartId: cart.id,
      productId: String(productId),
      addedQuantity: nextQuantity,
      unitPrice: approvedPrice,
    });

    if (userId && cart.sessionId) {
      await prisma.shoppingCart.update({
        where: { id: cart.id },
        data: { userId },
      });
    }

    return res.status(201).json({
      success: true,
      item,
      cart: await prepareCartPayload(await prisma.shoppingCart.findUnique({
        where: { id: cart.id },
        include: { items: { include: { product: true } } },
      })),
    });
  } catch (error) {
    console.error('Add to cart error:', error);
    return res.status(500).json({ error: 'Unable to add item to cart.' });
  }
});

router.put('/items/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const quantityValue = req.body?.quantity;
    const quantity = Number(quantityValue);
    const userId = req.user?.id || null;
    const sessionId = normalizeGuestSessionId(req.headers['x-session-id'])
      || normalizeGuestSessionId(req.body?.sessionId);

    if (!userId && !sessionId) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required.' });
    }
    if (quantityValue === undefined || !Number.isInteger(quantity)) {
      return res.status(400).json({ error: 'Quantity must be a whole number.' });
    }

    const cart = await resolveCart(userId, userId ? null : sessionId);
    const existing = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }

    if (quantity <= 0) {
      await prisma.cartItem.delete({ where: { id: existing.id } });
      return res.json({ success: true, removed: true });
    }

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product || !product.isActive) {
      return res.status(404).json({ error: 'Product not found or unavailable.' });
    }
    const approvedPrice = getApprovedEtbPrice(product);
    const updated = await prisma.cartItem.update({
      where: { id: existing.id },
      data: { quantity: Math.min(quantity, 99), unitPrice: approvedPrice },
    });

    return res.json({ success: true, item: updated });
  } catch (error) {
    console.error('Update cart item error:', error);
    return res.status(500).json({ error: 'Unable to update cart item.' });
  }
});

router.delete('/items/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const userId = req.user?.id || null;
    const sessionId = normalizeGuestSessionId(req.headers['x-session-id'])
      || normalizeGuestSessionId(req.body?.sessionId);
    if (!userId && !sessionId) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }
    const cart = await resolveCart(userId, userId ? null : sessionId);

    const existing = await prisma.cartItem.findUnique({
      where: {
        cartId_productId: {
          cartId: cart.id,
          productId,
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }

    await prisma.cartItem.delete({ where: { id: existing.id } });
    return res.json({ success: true, removed: true });
  } catch (error) {
    console.error('Remove cart item error:', error);
    return res.status(500).json({ error: 'Unable to remove cart item.' });
  }
});

router.post('/replace', async (req, res) => {
  try {
    const { items, sessionId } = req.body || {};
    const userId = req.user?.id || null;
    const providedSessionId = normalizeGuestSessionId(sessionId)
      || normalizeGuestSessionId(req.headers['x-session-id']);

    if (!providedSessionId && !userId) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Cart items must be an array.' });
    }

    const normalizedItems = items.map(({ productId, quantity }) => ({
      productId: String(productId || ''),
      quantity: Number(quantity),
    }));
    if (normalizedItems.some((item) => !item.productId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
      return res.status(400).json({ error: 'Each cart item needs a product ID and quantity from 1 to 99.' });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: normalizedItems.map((item) => item.productId) }, isActive: true },
      select: { id: true, slug: true },
    });
    if (products.length !== normalizedItems.length) {
      return res.status(400).json({ error: 'One or more cart products are unavailable.' });
    }

    const productById = new Map(
      applyApprovedEtbPrices(products).map((product) => [product.id, product]),
    );
    const cart = await resolveCart(userId, userId ? null : providedSessionId);
    await prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      if (normalizedItems.length) {
        await tx.cartItem.createMany({
          data: normalizedItems.map((item) => ({
            cartId: cart.id,
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: productById.get(item.productId).price,
          })),
        });
      }
    });

    const updatedCart = await prisma.shoppingCart.findUnique({
      where: { id: cart.id },
      include: { items: { include: { product: true } } },
    });
    return res.json({ success: true, cart: await prepareCartPayload(updatedCart) });
  } catch (error) {
    console.error('Replace cart error:', error);
    return res.status(500).json({ error: 'Unable to synchronize cart.' });
  }
});

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    const normalizedSessionId = normalizeGuestSessionId(sessionId);
    if (!normalizedSessionId) {
      return res.status(400).json({ error: 'Guest session identifier is required.' });
    }

    const guestCart = await prisma.shoppingCart.findFirst({
      where: { sessionId: normalizedSessionId },
      include: { items: { include: { product: true } } },
    });
    if (!guestCart || guestCart.items.length === 0) {
      return res.json({ success: true, merged: 0 });
    }

    const approvedProducts = applyApprovedEtbPrices(guestCart.items.map((item) => item.product));
    const approvedPriceByProductId = new Map(
      approvedProducts.map((product) => [product.id, product.price]),
    );
    let userCart = await prisma.shoppingCart.findFirst({ where: { userId: req.user.id } });
    if (!userCart) {
      userCart = await prisma.shoppingCart.create({ data: { userId: req.user.id } });
    }

    for (const item of guestCart.items) {
      await prisma.cartItem.upsert({
        where: {
          cartId_productId: {
            cartId: userCart.id,
            productId: item.productId,
          },
        },
        update: { quantity: item.quantity, unitPrice: approvedPriceByProductId.get(item.productId) },
        create: {
          cartId: userCart.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: approvedPriceByProductId.get(item.productId),
        },
      });
    }

    await prisma.shoppingCart.delete({ where: { id: guestCart.id } });
    return res.json({ success: true, merged: guestCart.items.length });
  } catch (error) {
    console.error('Sync cart error:', error);
    return res.status(500).json({ error: 'Unable to sync cart.' });
  }
});

export { router as cartRoutes };
