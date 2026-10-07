import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const { productId } = req.query;
    const reviews = await prisma.review.findMany({
      where: productId ? { productId: String(productId) } : undefined,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ reviews });
  } catch (error) {
    console.error('Review listing error:', error);
    return res.status(500).json({ error: 'Unable to load reviews.' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  try {
    const { productId, rating, comment } = req.body || {};

    if (!productId || !rating) {
      return res.status(400).json({ error: 'Product ID and rating are required.' });
    }

    const review = await prisma.review.upsert({
      where: {
        userId_productId: {
          userId: req.user.id,
          productId: String(productId),
        },
      },
      update: {
        rating: Number(rating),
        comment: comment || '',
      },
      create: {
        userId: req.user.id,
        productId: String(productId),
        rating: Number(rating),
        comment: comment || '',
      },
    });

    return res.status(201).json({ review, message: 'Review saved successfully.' });
  } catch (error) {
    console.error('Review creation error:', error);
    return res.status(500).json({ error: 'Unable to save review.' });
  }
});

export { router as reviewRoutes };
