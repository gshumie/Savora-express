import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { prisma } from '../db/prisma.js';
import { comparePassword, generateToken, hashPassword, DUMMY_PASSWORD_HASH } from '../lib/auth.js';
import { requireAuth, optionalAuth } from '../middleware/auth.js';
import { applyApprovedEtbPrices } from '../lib/approvedProductPricing.js';
import { createAuthSession, revokeAuthSession } from '../services/authSessions.js';
import { normalizeIpAddress, resolveClientIp } from '../lib/clientIp.js';

export { normalizeIpAddress, resolveClientIp };

async function mergeGuestCartToUser(database, sessionId, userId) {
  if (!sessionId) return;

  const guestCart = await database.shoppingCart.findFirst({
    where: { sessionId },
    include: { items: { include: { product: true } } },
  });

  if (!guestCart || guestCart.items.length === 0) return;

  const approvedProducts = applyApprovedEtbPrices(guestCart.items.map((item) => item.product));
  const approvedPriceByProductId = new Map(
    approvedProducts.map((product) => [product.id, product.price]),
  );
  let userCart = await database.shoppingCart.findFirst({ where: { userId } });

  if (!userCart) {
    userCart = await database.shoppingCart.create({
      data: { userId },
    });
  }

  for (const item of guestCart.items) {
    await database.cartItem.upsert({
      where: {
        cartId_productId: {
          cartId: userCart.id,
          productId: item.productId,
        },
      },
      update: {
        quantity: item.quantity,
        unitPrice: approvedPriceByProductId.get(item.productId),
      },
      create: {
        cartId: userCart.id,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: approvedPriceByProductId.get(item.productId),
      },
    });
  }

  await database.shoppingCart.delete({ where: { id: guestCart.id } });
}

export function createLoginRateLimiter({
  windowMs = config.authLoginRateLimitWindowMs ?? 60 * 1000,
  max = config.authLoginRateLimitMax ?? 5,
  message = { error: 'Too many login attempts. Please try again later.' },
  serviceUnavailableMessage = { error: 'Service temporarily unavailable. Please try again later.' },
  ...options
} = {}) {
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false, ...options.validate },
    keyGenerator: (req) => req.resolvedClientIp,
    message,
    handler: (req, res, _next, opts) => {
      res.status(opts.statusCode).json(opts.message);
    },
    ...options,
  });

  return (req, res, next) => {
    let clientIp = null;
    try {
      clientIp = resolveClientIp(req);
    } catch {
      clientIp = null;
    }

    if (!clientIp) {
      return res.status(503).json(serviceUnavailableMessage);
    }

    req.resolvedClientIp = clientIp;
    return limiter(req, res, next);
  };
}

export function createAuthRouter({
  database = prisma,
  hashPasswordFn = hashPassword,
  comparePasswordFn = comparePassword,
  generateTokenFn = generateToken,
  requireAuthMiddleware = requireAuth,
  loginRateLimiter = createLoginRateLimiter(),
} = {}) {
  const router = Router();
  const loginMiddlewares = loginRateLimiter ? [loginRateLimiter] : [];

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

      const existingUser = await database.user.findUnique({ where: { email: normalizedEmail } });
      if (existingUser) {
        return res.status(409).json({ error: 'A user with that email already exists.' });
      }

      const passwordHash = await hashPasswordFn(String(password));
      const { user, authSession } = await database.$transaction(async (transaction) => {
        const createdUser = await transaction.user.create({
          data: {
            name: String(name).trim(),
            email: normalizedEmail,
            passwordHash,
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        });
        const createdSession = await createAuthSession(transaction, createdUser.id);
        return { user: createdUser, authSession: createdSession };
      });

      const token = generateTokenFn(user, authSession.id);
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

  router.post('/login', ...loginMiddlewares, async (req, res) => {
    try {
      const { email, password, sessionId } = req.body || {};
      const normalizedEmail = String(email || '').trim().toLowerCase();

      if (!normalizedEmail || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const user = await database.user.findUnique({ where: { email: normalizedEmail } });
      if (!user) {
        await comparePasswordFn(String(password), DUMMY_PASSWORD_HASH);
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      const validPassword = await comparePasswordFn(String(password), user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      if (sessionId) {
        await mergeGuestCartToUser(database, String(sessionId), user.id);
      }

      const authSession = await createAuthSession(database, user.id);
      const token = generateTokenFn(user, authSession.id);
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

  router.post('/logout', requireAuthMiddleware, async (req, res) => {
    try {
      await revokeAuthSession(database, req.authSession.id, req.user.id);
      return res.json({ success: true, message: 'Logged out successfully.' });
    } catch {
      console.error('Authentication session revocation failed.');
      return res.status(503).json({ error: 'Unable to log out right now.' });
    }
  });

  router.get('/profile', requireAuthMiddleware, async (req, res) => {
    try {
      const user = await database.user.findUnique({
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

  router.get('/me', optionalAuth, async (req, res) => {
    try {
      if (!req.user?.id) {
        return res.json({ user: null, authenticated: false });
      }

      const user = await database.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      return res.json({ user, authenticated: Boolean(user) });
    } catch (error) {
      console.error('Auth me error:', error);
      return res.json({ user: null, authenticated: false });
    }
  });

  return router;
}

export const authRoutes = createAuthRouter();
