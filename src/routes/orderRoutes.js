import { Router } from 'express';
import Stripe from 'stripe';
import { prisma } from '../db/prisma.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;

function generateOrderNumber() {
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `SAV-${stamp}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

async function loadCartForOrder({ cartId, sessionId, userId }) {
  const cart = cartId
    ? await prisma.shoppingCart.findUnique({ where: { id: cartId }, include: { items: { include: { product: true } } } })
    : await prisma.shoppingCart.findFirst({
        where: userId ? { userId } : { sessionId: sessionId || 'guest-session' },
        include: { items: { include: { product: true } } },
      });

  if (!cart || cart.items.length === 0) {
    return { cart: null, orderItems: [], subtotal: 0, tax: 0, deliveryFee: 0, total: 0 };
  }

  let subtotal = 0;
  const orderItems = [];

  for (const item of cart.items) {
    const product = item.product;
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(product.price || 0);

    if (!product || !product.isActive) {
      throw new Error(`Product ${item.productId} is not available.`);
    }

    if (quantity <= 0) {
      throw new Error(`Quantity for ${product.name} must be greater than zero.`);
    }

    const lineTotal = Number((unitPrice * quantity).toFixed(2));
    subtotal += lineTotal;
    orderItems.push({ productId: item.productId, quantity, unitPrice });
  }

  return { cart, orderItems, subtotal };
}

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

router.post('/checkout', async (req, res) => {
  try {
    const { sessionId, customerName, customerEmail, customerPhone, fulfillment, notes, address, cartId } = req.body || {};
    const userId = req.user?.id || null;

    if (!customerName || !customerEmail) {
      return res.status(400).json({ error: 'Customer name and email are required.' });
    }

    const { cart, orderItems, subtotal } = await loadCartForOrder({ cartId, sessionId, userId });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty. Add items before checking out.' });
    }

    const taxRate = 0.08;
    const deliveryFee = fulfillment === 'pickup' ? 0 : 3.99;
    const tax = Number((subtotal * taxRate).toFixed(2));
    const total = Number((subtotal + tax + deliveryFee).toFixed(2));

    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          userId,
          orderNumber: generateOrderNumber(),
          status: 'PENDING',
          fulfillmentType: fulfillment === 'pickup' ? 'PICKUP' : 'DELIVERY',
          subtotal: Number(subtotal.toFixed(2)),
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
          provider: 'DEVELOPMENT',
          status: 'PENDING',
          amount: total,
          transactionId: `dev-${createdOrder.orderNumber}`,
          paymentIntentId: `dev-intent-${createdOrder.orderNumber}`,
        },
      });

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      await tx.shoppingCart.delete({ where: { id: cart.id } });

      return createdOrder;
    });

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
    console.error('Checkout error:', error);
    return res.status(500).json({ error: 'Unable to create the order.' });
  }
});

router.post('/checkout-session', async (req, res) => {
  try {
    const { sessionId, customerName, customerEmail, customerPhone, fulfillment, notes, address, cartId } = req.body || {};
    const userId = req.user?.id || null;

    if (!customerName || !customerEmail) {
      return res.status(400).json({ error: 'Customer name and email are required.' });
    }

    const { cart, orderItems, subtotal } = await loadCartForOrder({ cartId, sessionId, userId });

    if (!cart || cart.items.length === 0) {
      return res.status(400).json({ error: 'Your cart is empty. Add items before checking out.' });
    }

    const taxRate = 0.08;
    const deliveryFee = fulfillment === 'pickup' ? 0 : 3.99;
    const tax = Number((subtotal * taxRate).toFixed(2));
    const total = Number((subtotal + tax + deliveryFee).toFixed(2));
    const normalizedFulfillment = fulfillment === 'pickup' ? 'pickup' : 'delivery';

    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          userId,
          orderNumber: generateOrderNumber(),
          status: 'PENDING',
          fulfillmentType: normalizedFulfillment === 'pickup' ? 'PICKUP' : 'DELIVERY',
          subtotal: Number(subtotal.toFixed(2)),
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
          provider: 'DEVELOPMENT',
          status: 'PENDING',
          amount: total,
          transactionId: `dev-${createdOrder.orderNumber}`,
          paymentIntentId: `dev-intent-${createdOrder.orderNumber}`,
        },
      });

      return createdOrder;
    });

    if (!stripe) {
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
        message: 'Stripe is not configured. Payment is simulated in demo mode.',
      });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: customerEmail,
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(total * 100),
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
      success_url: `${config.clientUrl}/checkout.html?status=success&order=${encodeURIComponent(order.orderNumber)}`,
      cancel_url: `${config.clientUrl}/checkout.html?status=cancelled&order=${encodeURIComponent(order.orderNumber)}`,
    });

    await prisma.payment.update({
      where: { orderId: order.id },
      data: {
        provider: 'STRIPE',
        status: 'PENDING',
        transactionId: checkoutSession.id,
        paymentIntentId: checkoutSession.payment_intent || null,
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
    console.error('Checkout session error:', error);
    return res.status(500).json({ error: 'Unable to create a payment session.' });
  }
});

export { router as orderRoutes };
