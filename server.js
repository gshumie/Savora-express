import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

import { config } from './src/config.js';
import { prisma } from './src/db/prisma.js';
import { authRoutes } from './src/routes/authRoutes.js';
import { productRoutes } from './src/routes/productRoutes.js';
import { cartRoutes } from './src/routes/cartRoutes.js';
import { orderRoutes } from './src/routes/orderRoutes.js';
import { reviewRoutes } from './src/routes/reviewRoutes.js';
import { adminRoutes } from './src/routes/adminRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
const app = express();
const clientOrigin = new URL(config.clientUrl).origin;

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

app.post('/api/orders/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !config.stripeWebhookSecret) {
    return res.status(200).json({ received: true, mode: 'disabled' });
  }

  const signature = req.headers['stripe-signature'];

  try {
    const event = stripe.webhooks.constructEvent(req.body, signature, config.stripeWebhookSecret);

    if (event.type === 'checkout.session.completed') {
      const orderId = event.data.object.metadata?.orderId;
      if (orderId) {
        await prisma.order.update({
          where: { id: orderId },
          data: { status: 'CONFIRMED' },
        });

        await prisma.payment.update({
          where: { orderId },
          data: { status: 'PAID', provider: 'STRIPE' },
        });
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Stripe webhook verification failed:', error);
    return res.status(400).send('Webhook verification failed.');
  }
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
}));

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check database query failed:', error);
    res.status(500).json({ status: 'error', database: 'disconnected' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api', (_req, res) => {
  res.json({
    name: 'Savora Express API',
    version: '1.0.0',
    status: 'online',
  });
});

const publicFiles = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/about', 'about.html'],
  ['/about.html', 'about.html'],
  ['/menu', 'menu.html'],
  ['/menu.html', 'menu.html'],
  ['/checkout', 'checkout.html'],
  ['/checkout.html', 'checkout.html'],
  ['/contact', 'contact.html'],
  ['/contact.html', 'contact.html'],
  ['/style.css', 'style.css'],
  ['/script.js', 'script.js'],
]);

app.get([...publicFiles.keys()], (req, res) => {
  return res.sendFile(path.join(__dirname, publicFiles.get(req.path)));
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

const server = app.listen(config.port, () => {
  console.log(`Savora Express API running on http://localhost:${config.port}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});

export { app };
