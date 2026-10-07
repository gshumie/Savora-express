import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? '' : 'dev-secret-change-me');

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured when NODE_ENV=production.');
}

if (isProduction && (
  !process.env.JWT_SECRET
  || process.env.JWT_SECRET === 'change-this-to-a-long-random-secret'
  || process.env.JWT_SECRET.length < 32
)) {
  throw new Error('Set JWT_SECRET to a unique value of at least 32 characters when NODE_ENV=production.');
}

export const config = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
};
