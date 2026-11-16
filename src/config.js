import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { CURRENCY } from './lib/money.js';
import {
  validateCurrencyCode,
  validatePaymentConfiguration,
} from './lib/paymentConfiguration.js';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

export function parseRateLimitInteger({
  value,
  name,
  min,
  max,
  defaultValue,
  isProduction: isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
}) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }

  const raw = String(value).trim();
  const isStrictInteger = /^[-+]?\d+$/.test(raw);
  const parsed = Number(raw);

  if (!isStrictInteger || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    if (isProd) {
      throw new Error(`Invalid ${name}: must be an integer between ${min} and ${max}.`);
    }
    console.warn(`[config] Invalid ${name}. Falling back to default ${defaultValue}.`);
    return defaultValue;
  }

  return parsed;
}

export function resolveRateLimitConfigVar(
  primaryName,
  aliasName,
  min,
  max,
  defaultValue,
  isProd = isProduction
) {
  const primaryVal = process.env[primaryName];
  const aliasVal = process.env[aliasName];

  if (primaryVal !== undefined && primaryVal !== '') {
    return parseRateLimitInteger({
      value: primaryVal,
      name: primaryName,
      min,
      max,
      defaultValue,
      isProduction: isProd,
    });
  }

  if (aliasVal !== undefined && aliasVal !== '') {
    return parseRateLimitInteger({
      value: aliasVal,
      name: aliasName,
      min,
      max,
      defaultValue,
      isProduction: isProd,
    });
  }

  return defaultValue;
}

const configuredJwtSecret = process.env.JWT_SECRET;
const jwtSecretPlaceholderPattern = /dev-secret-change-me|change-this-to-a-long-random-secret|example|placeholder|replace|your[-_ ]?(?:secret|key)/i;
if (configuredJwtSecret && jwtSecretPlaceholderPattern.test(configuredJwtSecret)) {
  throw new Error('JWT_SECRET must be a private secret, not a placeholder or example value.');
}
if (isProduction && (
  !configuredJwtSecret
  || configuredJwtSecret.trim().length === 0
  || configuredJwtSecret.length < 32
)) {
  throw new Error('Set JWT_SECRET to a unique value of at least 32 characters when NODE_ENV=production.');
}
const jwtSecret = configuredJwtSecret || (isProduction ? '' : randomBytes(32).toString('hex'));

const configuredPaymentStatusTokenSecret = process.env.PAYMENT_STATUS_TOKEN_SECRET;
const hasUsablePaymentStatusTokenSecret = configuredPaymentStatusTokenSecret
  && configuredPaymentStatusTokenSecret.length >= 32
  && !/replace|example|placeholder/i.test(configuredPaymentStatusTokenSecret);
if (isProduction && (
  !configuredPaymentStatusTokenSecret
  || configuredPaymentStatusTokenSecret.trim().length === 0
  || configuredPaymentStatusTokenSecret.length < 32
  || /replace|example|placeholder/i.test(configuredPaymentStatusTokenSecret)
)) {
  throw new Error('Set PAYMENT_STATUS_TOKEN_SECRET to a private random value of at least 32 characters in production.');
}
const paymentStatusTokenSecret = hasUsablePaymentStatusTokenSecret
  ? configuredPaymentStatusTokenSecret
  : (isProduction ? '' : randomBytes(32).toString('hex'));

const rawChapaKey = process.env.CHAPA_SECRET_KEY || '';
const hasChapaKey = rawChapaKey.trim().length > 0 && !/placeholder|example|your/i.test(rawChapaKey);
const paymentProvider = process.env.PAYMENT_PROVIDER || (hasChapaKey ? 'chapa' : (process.env.STRIPE_SECRET_KEY ? 'stripe' : 'demo'));
const chapaEnvironment = process.env.CHAPA_ENVIRONMENT || (/test/i.test(rawChapaKey) ? 'test' : (isProduction ? 'live' : 'test'));
const chapaCurrency = process.env.CHAPA_CURRENCY || CURRENCY;
const stripeCurrency = validateCurrencyCode(process.env.STRIPE_CURRENCY || 'USD', 'STRIPE_CURRENCY');
const etbPricesApproved = process.env.ETB_PRICES_APPROVED === 'true';

if (!['stripe', 'chapa', 'demo'].includes(paymentProvider)) {
  throw new Error('PAYMENT_PROVIDER must be stripe, chapa, or demo.');
}

if (isProduction && paymentProvider === 'demo') {
  console.warn('[config] WARNING: Running in production mode with PAYMENT_PROVIDER="demo". Live payments are not being processed.');
}

if (!['test', 'live'].includes(chapaEnvironment)) {
  throw new Error('CHAPA_ENVIRONMENT must be test or live.');
}

if (chapaCurrency !== CURRENCY) {
  throw new Error('CHAPA_CURRENCY must be ETB.');
}

validatePaymentConfiguration({
  paymentProvider,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripeCurrency,
  catalogCurrency: CURRENCY,
});

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be configured when NODE_ENV=production.');
}

// URL Validation
const clientUrl = process.env.CLIENT_URL ? process.env.CLIENT_URL.trim() : (isProduction ? '' : 'http://localhost:3000');
if (isProduction && !clientUrl) {
  throw new Error('CLIENT_URL must be configured when running in production.');
}

const appBaseUrl = (process.env.APP_BASE_URL && process.env.APP_BASE_URL.trim()) || clientUrl;
if (isProduction && !appBaseUrl) {
  throw new Error('APP_BASE_URL must be configured when running in production.');
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret,
  paymentStatusTokenSecret,
  clientUrl,
  appBaseUrl,
  paymentProvider,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  chapaSecretKey: process.env.CHAPA_SECRET_KEY || '',
  chapaWebhookSecret: process.env.CHAPA_WEBHOOK_SECRET || '',
  chapaEnvironment,
  chapaCurrency,
  stripeCurrency,
  etbPricesApproved,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  adminNotifyEmail: process.env.ADMIN_NOTIFY_EMAIL || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
  authLoginRateLimitWindowMs: resolveRateLimitConfigVar(
    'AUTH_LOGIN_RATE_LIMIT_WINDOW_MS',
    'LOGIN_RATE_LIMIT_WINDOW_MS',
    1000,
    86400000,
    60 * 1000,
    isProduction
  ),
  authLoginRateLimitMax: resolveRateLimitConfigVar(
    'AUTH_LOGIN_RATE_LIMIT_MAX',
    'LOGIN_RATE_LIMIT_MAX',
    1,
    10000,
    5,
    isProduction
  ),
};
