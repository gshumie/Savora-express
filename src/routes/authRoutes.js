import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import { comparePassword, generateToken, hashPassword } from '../lib/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

async function mergeGuestCartToUser(sessionId, userId) {
  if (!sessionId) return;

  const guestCart = await prisma.shoppingCart.findFirst({
    where: { sessionId },
    include: { items: true },
  });

  if (!guestCart || guestCart.items.length === 0) return;

  let userCart = await prisma.shoppingCart.findFirst({ where: { userId } });

  if (!userCart) {
    userCart = await prisma.shoppingCart.create({
      data: { userId },
    });
  }

  for (const item of guestCart.items) {
    await prisma.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: userCart.id,
          productId: item.productId,
        },
      },
      update: {
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      },
      create: {
        cartId: userCart.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      },
    });
  }

  await prisma.shoppingCart.delete({ where: { id: guestCart.id } });
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (normalizedEmail.length < 3 || String(password).length < 6) {
      return res.status(400).json({ error: 'Please provide a valid email and a password of at least 6 characters.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }

    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        email: normalizedEmail,
        passwordHash: await hashPassword(String(password)),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
    });

    const token = generateToken(user);
    return res.status(201).json({
      token,
      user,
      message: 'User registered successfully.',
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ error: 'Unable to register user.' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password, sessionId } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const validPassword = await comparePassword(String(password), user.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (sessionId) {
      await mergeGuestCartToUser(String(sessionId), user.id);
    }

    const token = generateToken(user);
    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      message: 'Login successful.',
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Unable to log in.' });
  }
});

router.post('/logout', requireAuth, (_req, res) => {
  return res.json({ success: true, message: 'Logged out successfully.' });
});

router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    return res.json({ user });
  } catch (error) {
    console.error('Profile error:', error);
    return res.status(500).json({ error: 'Unable to load profile.' });
  }
});

export { router as authRoutes };
