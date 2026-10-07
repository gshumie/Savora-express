import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';

const router = Router();

function mapProduct(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    category: product.category?.name || 'General',
    categoryId: product.categoryId,
    price: Number(product.price),
    description: product.description,
    image: product.image,
    rating: Number(product.rating ?? 4.7),
    reviews: Number(product.reviews ?? 0),
    popularity: Number(product.popularity ?? 0),
    badge: product.badge || null,
    originalPrice: product.originalPrice ? Number(product.originalPrice) : null,
    featured: Boolean(product.featured),
    isActive: product.isActive,
    stock: product.stock,
  };
}

router.get('/', async (req, res) => {
  try {
    const { category, q } = req.query;
    const where = {
      isActive: true,
      ...(category ? { category: { name: String(category) } } : {}),
      ...(q ? { OR: [{ name: { contains: String(q), mode: 'insensitive' } }, { description: { contains: String(q), mode: 'insensitive' } }] } : {}),
    };

    const products = await prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: [{ featured: 'desc' }, { popularity: 'desc' }, { name: 'asc' }],
    });

    return res.json({ products: products.map(mapProduct) });
  } catch (error) {
    console.error('Product list error:', error);
    return res.status(500).json({ error: 'Unable to load menu products.' });
  }
});

router.get('/categories', async (_req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
    });

    return res.json({ categories });
  } catch (error) {
    console.error('Category list error:', error);
    return res.status(500).json({ error: 'Unable to load product categories.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: req.params.id },
      include: { category: true },
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found.' });
    }

    return res.json({ product: mapProduct(product) });
  } catch (error) {
    console.error('Single product lookup error:', error);
    return res.status(500).json({ error: 'Unable to load product.' });
  }
});

router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, categoryId, price, description, image, badge, originalPrice, featured, stock } = req.body || {};

    if (!name || !categoryId || !price) {
      return res.status(400).json({ error: 'Name, category, and price are required.' });
    }

    const category = await prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      return res.status(400).json({ error: 'Category does not exist.' });
    }

    const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const product = await prisma.product.create({
      data: {
        name: String(name).trim(),
        slug,
        categoryId,
        price: Number(price),
        description: description || '',
        image: image || 'https://images.unsplash.com/photo-1547592180-85f173990554',
        badge: badge || null,
        originalPrice: originalPrice ? Number(originalPrice) : null,
        featured: Boolean(featured),
        stock: Number(stock || 100),
        isActive: true,
        rating: 4.8,
        reviews: 0,
        popularity: 80,
      },
      include: { category: true },
    });

    return res.status(201).json({ product: mapProduct(product) });
  } catch (error) {
    console.error('Create product error:', error);
    return res.status(500).json({ error: 'Unable to create product.' });
  }
});

export { router as productRoutes };
