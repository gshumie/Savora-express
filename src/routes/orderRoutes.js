import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import Stripe from 'stripe';
import { prisma } from '../db/prisma.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { requireEtbPriceApproval } from '../middleware/pricingApproval.js';
import {
  calculateCheckoutTotals,
  minorUnitsToDecimal,
  toMinorUnits,
} from '../lib/money.js';
import { applyApprovedEtbPrices } from '../lib/approvedProductPricing.js';
import {
  initializeChapaTransaction,
  processChapaWebhook,
  resolvePaymentProvider,
} from '../services/chapa.js';
import { createOrderStatusToken } from '../lib/orderStatusToken.js';
import { initializePaymentProvider } from '../services/paymentInitialization.js';
import { normalizeGuestSessionId } from '../lib/cartIdentity.js';

const router = Router();
const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;

function generateOrderNumber() {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `SAV-${stamp}-${randomBytes(16).toString('hex').toUpperCase()}`;
}

async function loadCartForOrder({ cartId, sessionId, userId, database = prisma }) {
  const normalizedSessionId = normalizeGuestSessionId(sessionId);
  if (!userId && !normalizedSessionId) {
    throw new MissingCartIdentityError();
  }

  const where = cartId
    ? (userId
        ? { id: cartId, userId }
        : { id: cartId, sessionId: normalizedSessionId })
    : userId ? { userId } : { sessionId: normalizedSessionId };
  const cart = where
    ? await database.shoppingCart.findFirst({
        where,
        include: { items: { include: { product: true } } },
      })
    : null;

  if (!cart || cart.items.length === 0) {
    return { cart: null, orderItems: [], subtotalMinorUnits: 0 };
  }

  const approvedProducts = applyApprovedEtbPrices(cart.items.map((item) => item.product));
  let subtotalMinorUnits = 0;
  const orderItems = [];

  for (const [index, item] of cart.items.entries()) {
    const product = approvedProducts[index];
    const quantity = item.quantity;
    if (!product || !product.isActive) {
      throw new Error(`Product ${item.productId} is not available.`);
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new InvalidCartQuantityError();
    }

    const unitPriceMinorUnits = toMinorUnits(product.price);
    const lineTotalMinorUnits = unitPriceMinorUnits * quantity;
    if (!Number.isSafeInteger(lineTotalMinorUnits + subtotalMinorUnits)) {
      throw new Error('Order total exceeds the supported monetary range.');
    }
    subtotalMinorUnits += lineTotalMinorUnits;
    orderItems.push({
      productId: item.productId,
      quantity,
      unitPrice: minorUnitsToDecimal(unitPriceMinorUnits),
    });
  }

  return { cart, orderItems, subtotalMinorUnits };
}

class InvalidCartQuantityError extends Error {}
class MissingCartIdentityError extends Error {}

router.get('/', requireAuth, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { userId: req.user.id },
      include: {
        items: { include: { product: true } },
        payment: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ orders });
  } catch (error) {
    console.error('Order history error:', error);
    return res.status(500).json({ error: 'Unable to load the order history.' });
  }
});

router.get('/:id', requireAuth, async (req, res) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, userId: req.user.id },
      include: {
        items: { include: { product: true } },
        payment: true,
      },
    });

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    return res.json({ order });
  } catch (error) {
    console.error('Order lookup error:', error);
    return res.status(500).json({ error: 'Unable to load the order.' });
  }
});

router.post('/chapa/webhook', async (req, res) => {
  try {
    const result = await processChapaWebhook({
      rawBody: req.body,
      headers: req.headers,
      webhookSecret: config.chapaWebhookSecret,
      prisma,
      secretKey: config.chapaSecretKey,
      currency: config.chapaCurrency,
    });
    return res.status(result.statusCode).json(result.body);
  } catch (error) {
    console.error('Chapa webhook verification failed.');
    return res.status(503).json({ error: 'Payment verification is temporarily unavailable.' });
  }
});

router.post('/checkout', requireEtbPriceApproval(config), async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, fulfillment, notes, address, cartId } = req.body || {};
    const sessionId = normalizeGuestSessionId(req.body?.sessionId)
      || normalizeGuestSessionId(req.headers['x-session-id']);
    const userId = req.user?.id || null;

    if (!userId && !sessionId) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }
    if (!customerName || !customerEmail) {
      return res.status(400).json({ error: 'Customer name and email are required.' });
    }

    const { cart, orderItems, subtotalMinorUnits } = await loadCartForOrder({ cartId, sessionId, userId });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty. Add items before checking out.' });
    }

    const totals = calculateCheckoutTotals(subtotalMinorUnits, fulfillment);
    const subtotal = minorUnitsToDecimal(totals.subtotalMinorUnits);
    const tax = minorUnitsToDecimal(totals.taxMinorUnits);
    const deliveryFee = minorUnitsToDecimal(totals.deliveryFeeMinorUnits);
    const total = minorUnitsToDecimal(totals.totalMinorUnits);

    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          userId,
          orderNumber: generateOrderNumber(),
          status: 'PENDING',
          fulfillmentType: fulfillment === 'pickup' ? 'PICKUP' : 'DELIVERY',
          subtotal,
          tax,
          deliveryFee,
          total,
          customerName,
          customerEmail,
          customerPhone: customerPhone || null,
          shippingAddress: address || null,
          notes: notes || null,
        },
      });

      await tx.orderItem.createMany({
        data: orderItems.map((item) => ({
          orderId: createdOrder.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });

      const provider = resolvePaymentProvider(config);
      await tx.payment.create({
        data: {
          orderId: createdOrder.id,
          provider: provider === 'chapa' ? 'CHAPA' : provider === 'stripe' ? 'STRIPE' : 'DEVELOPMENT',
          status: 'PENDING',
          amount: total,
          transactionId: provider === 'demo' ? `dev-${createdOrder.orderNumber}` : null,
          paymentIntentId: provider === 'demo' ? `dev-intent-${createdOrder.orderNumber}` : null,
        },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.shoppingCart.delete({ where: { id: cart.id } });

      return createdOrder;
    });

    const provider = resolvePaymentProvider(config);
    if (provider === 'chapa') {
      const txRef = order.orderNumber;
      const returnUrl = new URL('/checkout.html', config.clientUrl);
      returnUrl.searchParams.set('status', 'success');
      returnUrl.searchParams.set('order', order.orderNumber);

      const paymentStatusToken = createOrderStatusToken(order.orderNumber, config.paymentStatusTokenSecret);
      returnUrl.hash = `payment-token=${encodeURIComponent(paymentStatusToken)}`;

      const { checkoutUrl } = await initializePaymentProvider({
        prisma,
        orderId: order.id,
        provider: 'CHAPA',
        initialize: async () => {
          await prisma.payment.update({
            where: { orderId: order.id },
            data: { transactionId: txRef },
          });
          return initializeChapaTransaction({
            secretKey: config.chapaSecretKey,
            amount: total,
            currency: config.chapaCurrency,
            email: customerEmail,
            customerName,
            phone: customerPhone,
            txRef,
            returnUrl: returnUrl.toString(),
            callbackUrl: config.chapaWebhookSecret
              ? new URL('/api/orders/chapa/webhook', config.appBaseUrl).toString()
              : undefined,
          });
        },
      });

      return res.status(201).json({
        success: true,
        paymentUrl: checkoutUrl,
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: Number(order.total),
          fulfillmentType: order.fulfillmentType,
        },
        message: 'Order created successfully. Redirecting to Chapa payment.',
      });
    }

    return res.status(201).json({
      success: true,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: Number(order.total),
        fulfillmentType: order.fulfillmentType,
      },
      message: 'Order created successfully. Payment is still pending in development mode.',
    });
  } catch (error) {
    if (error instanceof InvalidCartQuantityError) {
      return res.status(400).json({ error: 'Cart contains an invalid item quantity.' });
    }
    if (error instanceof MissingCartIdentityError) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }
    console.error('Checkout error:', error);
    return res.status(500).json({ error: 'Unable to create the order.' });
  }
});

router.post('/checkout-session', requireEtbPriceApproval(config), async (req, res) => {
  try {
    const { customerName, customerEmail, customerPhone, fulfillment, notes, address, cartId } = req.body || {};
    const sessionId = normalizeGuestSessionId(req.body?.sessionId)
      || normalizeGuestSessionId(req.headers['x-session-id']);
    const userId = req.user?.id || null;

    if (!userId && !sessionId) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }

    const provider = resolvePaymentProvider(config);
    if (provider === 'unavailable') {
      return res.status(503).json({ error: 'The selected payment provider is not configured.' });
    }
    if (!customerName || !customerEmail) {
      return res.status(400).json({ error: 'Customer name and email are required.' });
    }

    const { cart, orderItems, subtotalMinorUnits } = await loadCartForOrder({ cartId, sessionId, userId });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty. Add items before checking out.' });
    }

    const totals = calculateCheckoutTotals(subtotalMinorUnits, fulfillment);
    const subtotal = minorUnitsToDecimal(totals.subtotalMinorUnits);
    const tax = minorUnitsToDecimal(totals.taxMinorUnits);
    const deliveryFee = minorUnitsToDecimal(totals.deliveryFeeMinorUnits);
    const total = minorUnitsToDecimal(totals.totalMinorUnits);
    const normalizedFulfillment = fulfillment === 'pickup' ? 'pickup' : 'delivery';

    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          userId,
          orderNumber: generateOrderNumber(),
          status: 'PENDING',
          fulfillmentType: normalizedFulfillment === 'pickup' ? 'PICKUP' : 'DELIVERY',
          subtotal,
          tax,
          deliveryFee,
          total,
          customerName,
          customerEmail,
          customerPhone: customerPhone || null,
          shippingAddress: address || null,
          notes: notes || null,
        },
      });

      await tx.orderItem.createMany({
        data: orderItems.map((item) => ({
          orderId: createdOrder.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        })),
      });

      await tx.payment.create({
        data: {
          orderId: createdOrder.id,
          provider: provider === 'chapa' ? 'CHAPA' : provider === 'stripe' ? 'STRIPE' : 'DEVELOPMENT',
          status: 'PENDING',
          amount: total,
          transactionId: provider === 'demo' ? `dev-${createdOrder.orderNumber}` : null,
          paymentIntentId: provider === 'demo' ? `dev-intent-${createdOrder.orderNumber}` : null,
        },
      });

      return createdOrder;
    });

    if (provider === 'demo') {
      await prisma.payment.update({
        where: { orderId: order.id },
        data: { provider: 'DEVELOPMENT', status: 'PENDING' },
      });

      return res.status(200).json({
        success: true,
        demoMode: true,
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: Number(order.total),
          fulfillmentType: order.fulfillmentType,
        },
        message: 'A supported payment provider is not configured. Payment is simulated in demo mode.',
      });
    }

    if (provider === 'chapa') {
      const txRef = order.orderNumber;
      const returnUrl = new URL('/checkout.html', config.clientUrl);
      returnUrl.searchParams.set('status', 'success');
      returnUrl.searchParams.set('order', order.orderNumber);

      const paymentStatusToken = createOrderStatusToken(order.orderNumber, config.paymentStatusTokenSecret);
      returnUrl.hash = `payment-token=${encodeURIComponent(paymentStatusToken)}`;

      const { checkoutUrl } = await initializePaymentProvider({
        prisma,
        orderId: order.id,
        provider: 'CHAPA',
        initialize: async () => {
          await prisma.payment.update({
            where: { orderId: order.id },
            data: { transactionId: txRef },
          });
          return initializeChapaTransaction({
            secretKey: config.chapaSecretKey,
            amount: total,
            currency: config.chapaCurrency,
            email: customerEmail,
            customerName,
            phone: customerPhone,
            txRef,
            returnUrl: returnUrl.toString(),
            callbackUrl: config.chapaWebhookSecret
              ? new URL('/api/orders/chapa/webhook', config.appBaseUrl).toString()
              : undefined,
          });
        },
      });

      return res.status(200).json({
        success: true,
        demoMode: false,
        paymentUrl: checkoutUrl,
        order: {
          id: order.id,
          orderNumber: order.orderNumber,
          status: order.status,
          total: Number(order.total),
          fulfillmentType: order.fulfillmentType,
        },
        message: 'Your payment session is ready.',
      });
    }

    const paymentStatusToken = createOrderStatusToken(order.orderNumber, config.paymentStatusTokenSecret);
    const successUrl = new URL('/checkout.html', config.clientUrl);
    successUrl.searchParams.set('status', 'success');
    successUrl.searchParams.set('order', order.orderNumber);
    successUrl.hash = `payment-token=${encodeURIComponent(paymentStatusToken)}`;
    const checkoutSession = await initializePaymentProvider({
      prisma,
      orderId: order.id,
      provider: 'STRIPE',
      initialize: async () => {
        let session;
        try {
          session = await stripe.checkout.sessions.create({
            mode: 'payment',
            customer_email: customerEmail,
            payment_method_types: ['card'],
            line_items: [{
              price_data: {
                currency: config.stripeCurrency.toLowerCase(),
                unit_amount: totals.totalMinorUnits,
                product_data: {
                  name: 'Savora Express Order',
                  description: `Order for ${customerName} • ${normalizedFulfillment === 'pickup' ? 'Pickup' : 'Delivery'}`,
                },
              },
              quantity: 1,
            }],
            metadata: {
              orderId: order.id,
              customerName,
              customerEmail,
              fulfillment: normalizedFulfillment,
              sessionId: sessionId || '',
            },
            success_url: successUrl.toString(),
            cancel_url: `${config.clientUrl}/checkout.html?status=cancelled&order=${encodeURIComponent(order.orderNumber)}`,
          }, {
            idempotencyKey: `savora-checkout-${order.id}`,
          });

          await prisma.payment.update({
            where: { orderId: order.id },
            data: {
              provider: 'STRIPE',
              status: 'PENDING',
              transactionId: session.id,
              paymentIntentId: session.payment_intent || null,
            },
          });
          return session;
        } catch (error) {
          if (session?.id) {
            try {
              await stripe.checkout.sessions.expire(session.id);
            } catch {
              console.error('Unable to expire an unpersisted Stripe checkout session.');
            }
          }
          throw error;
        }
      },
    });

    return res.status(200).json({
      success: true,
      demoMode: false,
      paymentUrl: checkoutSession.url,
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        total: Number(order.total),
        fulfillmentType: order.fulfillmentType,
      },
      message: 'Your payment session is ready.',
    });
  } catch (error) {
    if (error instanceof InvalidCartQuantityError) {
      return res.status(400).json({ error: 'Cart contains an invalid item quantity.' });
    }
    if (error instanceof MissingCartIdentityError) {
      return res.status(400).json({ error: 'A guest session identifier is required.' });
    }
    console.error('Checkout session setup failed.');
    return res.status(500).json({ error: 'Unable to create a payment session.' });
  }
});

export {
  InvalidCartQuantityError,
  loadCartForOrder,
  MissingCartIdentityError,
  router as orderRoutes,
};
