import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/summary', async (_req, res) => {
  try {
    const [orderCount, totalRevenue, customerCount, productCount] = await Promise.all([
      prisma.order.count(),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'PAID' },
      }),
      prisma.user.count(),
      prisma.product.count(),
    ]);

    return res.json({
      summary: {
        totalOrders: orderCount,
        totalRevenue: Number(totalRevenue._sum.amount || 0),
        customers: customerCount,
        products: productCount,
      },
    });
  } catch (error) {
    console.error('Admin summary error:', error);
    return res.status(500).json({ error: 'Unable to load admin summary.' });
  }
});

router.get('/orders', async (_req, res) => {
  try {
    const orders = await prisma.order.findMany({
      include: {
        items: { include: { product: true } },
        payment: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ orders });
  } catch (error) {
    console.error('Admin orders error:', error);
    return res.status(500).json({ error: 'Unable to load orders.' });
  }
});

router.patch('/orders/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    const order = await prisma.order.update({
      where: { id: req.params.id },
      data: { status },
    });

    return res.json({ order, message: 'Order status updated.' });
  } catch (error) {
    console.error('Order status update error:', error);
    return res.status(500).json({ error: 'Unable to update order status.' });
  }
});

export { router as adminRoutes };
