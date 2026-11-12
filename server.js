import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

import { config } from './src/config.js';
import { CURRENCY } from './src/lib/money.js';
import { prisma } from './src/db/prisma.js';
import { authRoutes } from './src/routes/authRoutes.js';
import { productRoutes } from './src/routes/productRoutes.js';
import { cartRoutes } from './src/routes/cartRoutes.js';
import { orderRoutes } from './src/routes/orderRoutes.js';
import { reviewRoutes } from './src/routes/reviewRoutes.js';
import { adminRoutes } from './src/routes/adminRoutes.js';
import { createPaymentDiagnosticsRouter } from './src/routes/paymentDiagnostics.js';
import { createStripeWebhookHandler } from './src/services/stripeWebhook.js';
import { createPaymentStatusHandler } from './src/services/paymentStatus.js';
import { resolvePaymentProvider } from './src/services/chapa.js';
import { createRateLimiterMiddleware } from './src/lib/clientIp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
const app = express();
const clientOrigin = new URL(config.clientUrl).origin;

export function createGlobalRateLimiter(options = {}) {
  return createRateLimiterMiddleware({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Too many requests. Please try again later.' },
    ...options,
  });
}

app.use(cors({
  origin: clientOrigin,
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      connectSrc: ["'self'", clientOrigin, 'https://api.stripe.com'],
      objectSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: false,
}));

app.use('/api/orders/chapa/webhook', express.raw({ type: 'application/json' }));

app.post(
  '/api/orders/webhook',
  express.raw({ type: 'application/json' }),
  createStripeWebhookHandler({ stripe, prisma, config }),
);

app.use(morgan('dev'));

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check database query failed:', error);
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/about', 'about.html'],
  ['/about.html', 'about.html'],
  ['/menu', 'menu.html'],
  ['/menu.html', 'menu.html'],
  ['/product', 'product.html'],
  ['/product.html', 'product.html'],
  ['/checkout', 'checkout.html'],
  ['/checkout.html', 'checkout.html'],
  ['/contact', 'contact.html'],
  ['/contact.html', 'contact.html'],
  ['/login', 'login.html'],
  ['/login.html', 'login.html'],
  ['/admin', 'admin.html'],
  ['/admin.html', 'admin.html'],
  ['/style.css', 'style.css'],
  ['/script.js', 'script.js'],
  ['/money.js', 'src/lib/money.js'],
  ['/approvedPrices.js', 'src/lib/approvedPrices.js'],
  ['/cartPersistence.js', 'src/lib/cartPersistence.js'],
]);

app.get('/api/checkout-config', (_req, res) => {
  const paymentProvider = resolvePaymentProvider(config);
  let paymentEnvironment = null;

  if (paymentProvider === 'chapa') {
    paymentEnvironment = config.chapaEnvironment;
  } else if (paymentProvider === 'stripe') {
    if (config.stripeSecretKey.startsWith('sk_live_') || config.stripeSecretKey.startsWith('rk_live_')) {
      paymentEnvironment = 'live';
    } else if (config.stripeSecretKey.startsWith('sk_test_') || config.stripeSecretKey.startsWith('rk_test_')) {
      paymentEnvironment = 'test';
    }
  } else if (paymentProvider === 'demo') {
    paymentEnvironment = 'test';
  }

  res.json({
    currency: CURRENCY,
    pricesApproved: config.etbPricesApproved,
    paymentProvider,
    paymentEnvironment,
  });
});

app.get([...publicFiles.keys()], (req, res) => {
  return res.sendFile(path.join(__dirname, publicFiles.get(req.path)));
});

app.use(createGlobalRateLimiter());

app.post(
  '/api/orders/payment-status',
  express.json({ limit: '4kb' }),
  createPaymentStatusHandler({ prisma, config }),
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/diagnostics', createPaymentDiagnosticsRouter(config));

app.get('/api', (_req, res) => {
  res.json({
    name: 'Savora Express API',
    version: '1.0.0',
    status: 'online',
  });
});

app.get('/api/payments/config', (_req, res) => {
  const paymentProvider = resolvePaymentProvider(config);
  let paymentEnvironment = null;

  if (paymentProvider === 'chapa') {
    paymentEnvironment = config.chapaEnvironment;
  } else if (paymentProvider === 'stripe') {
    if (config.stripeSecretKey.startsWith('sk_live_') || config.stripeSecretKey.startsWith('rk_live_')) {
      paymentEnvironment = 'live';
    } else if (config.stripeSecretKey.startsWith('sk_test_') || config.stripeSecretKey.startsWith('rk_test_')) {
      paymentEnvironment = 'test';
    }
  } else if (paymentProvider === 'demo') {
    paymentEnvironment = 'test';
  }

  res.json({
    currency: CURRENCY,
    pricesApproved: config.etbPricesApproved,
    paymentProvider,
    paymentEnvironment,
  });
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }
  return res.status(404).send('Not found.');
});

app.use((error, _req, res, _next) => {
  console.error('Unhandled API error:', error);
  res.status(500).json({
    error: 'Unexpected server error',
    message: 'Something went wrong.',
  });
});

let server = null;

if (!process.env.VERCEL) {
  server = app.listen(config.port, () => {
    console.log(`Savora Express API running on http://localhost:${config.port}`);
  });

  process.on('SIGINT', async () => {
    await prisma.$disconnect();
    if (server) {
      server.close(() => process.exit(0));
    } else {
      process.exit(0);
    }
  });
}

export { app, server };
export default app;
