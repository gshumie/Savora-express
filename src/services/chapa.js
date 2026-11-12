import { createHmac, timingSafeEqual } from 'node:crypto';
import { toMinorUnits, minorUnitsToDecimal } from '../lib/money.js';

const CHAPA_API_URL = 'https://api.chapa.co/v1';

function hasChapaSecretKey(secretKey) {
  return typeof secretKey === 'string'
    && secretKey.trim().length > 0
    && !/your|example|placeholder/i.test(secretKey);
}

export function canUseChapa({ nodeEnv, environment, secretKey }) {
  if (!hasChapaSecretKey(secretKey)) return false;
  if (nodeEnv === 'production') {
    return environment === 'live';
  }
  return ['development', 'test'].includes(nodeEnv)
    && environment === 'test';
}

export function resolvePaymentProvider(config) {
  const requestedProvider = config.paymentProvider;
  const isProduction = config.nodeEnv === 'production';
  if (requestedProvider === 'chapa') {
    return canUseChapa({
      nodeEnv: config.nodeEnv,
      environment: config.chapaEnvironment,
      secretKey: config.chapaSecretKey,
    }) ? 'chapa' : (isProduction ? 'unavailable' : 'demo');
  }
  if (requestedProvider === 'stripe') {
    return config.stripeSecretKey
      ? 'stripe'
      : (isProduction ? 'unavailable' : 'demo');
  }
  return 'demo';
}

async function chapaRequest(path, { secretKey, method = 'GET', body, fetchImpl = fetch }) {
  const response = await fetchImpl(`${CHAPA_API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('Chapa returned an invalid response.');
  }

  if (!response.ok || result?.status !== 'success') {
    throw new Error('Chapa could not complete the payment request.');
  }
  return result;
}

export async function initializeChapaTransaction({
  secretKey,
  amount,
  currency,
  email,
  customerName,
  phone,
  txRef,
  returnUrl,
  callbackUrl,
  fetchImpl,
}) {
  const nameParts = String(customerName).trim().split(/\s+/);
  const firstName = nameParts.shift() || 'Customer';
  const lastName = nameParts.join(' ') || 'Customer';
  const body = {
    amount: minorUnitsToDecimal(toMinorUnits(amount)),
    currency,
    email,
    first_name: firstName,
    last_name: lastName,
    tx_ref: txRef,
    return_url: returnUrl,
    customization: {
      title: 'Savora Express',
      description: `Order ${txRef}`,
    },
  };
  if (callbackUrl) body.callback_url = callbackUrl;
  if (/^(09|07)\d{8}$/.test(String(phone || '').replace(/\s+/g, ''))) {
    body.phone_number = String(phone).replace(/\s+/g, '');
  }

  const result = await chapaRequest('/transaction/initialize', {
    secretKey,
    method: 'POST',
    body,
    fetchImpl,
  });
  const checkoutUrl = result?.data?.checkout_url;
  let parsedUrl;
  try {
    parsedUrl = new URL(checkoutUrl);
  } catch {
    throw new Error('Chapa returned an invalid checkout URL.');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'checkout.chapa.co') {
    throw new Error('Chapa returned an untrusted checkout URL.');
  }
  return { checkoutUrl };
}

export async function verifyChapaTransaction({ secretKey, txRef, fetchImpl }) {
  const result = await chapaRequest(`/transaction/verify/${encodeURIComponent(txRef)}`, {
    secretKey,
    fetchImpl,
  });
  return result.data;
}

function constantTimeMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function isValidChapaWebhookSignature(rawBody, headers, webhookSecret) {
  if (!webhookSecret || !Buffer.isBuffer(rawBody)) return false;
  const secretHashSignature = headers['x-chapa-signature'];
  const payloadSignature = headers['chapa-signature'];
  const expectedPayloadSignature = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
  return constantTimeMatches(secretHashSignature, webhookSecret)
    || constantTimeMatches(payloadSignature, expectedPayloadSignature);
}

export async function processChapaWebhook({
  rawBody,
  headers,
  webhookSecret,
  prisma,
  secretKey,
  currency,
  fetchImpl,
}) {
  if (!isValidChapaWebhookSignature(rawBody, headers, webhookSecret)) {
    return { statusCode: 401, body: { error: 'Invalid Chapa webhook signature.' } };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { statusCode: 400, body: { error: 'Invalid webhook payload.' } };
  }

  const txRef = payload?.tx_ref || payload?.data?.tx_ref;
  if (typeof txRef !== 'string' || !txRef) {
    return { statusCode: 400, body: { error: 'Webhook transaction reference is missing.' } };
  }

  const result = await verifyAndApplyChapaPayment({
    prisma,
    txRef,
    secretKey,
    currency,
    fetchImpl,
  });
  return { statusCode: 200, body: { received: true, paymentStatus: result.paymentStatus } };
}

function transactionMatchesOrder(verified, payment, currency) {
  if (
    String(verified?.status || '').toLowerCase() !== 'success'
    || verified?.tx_ref !== payment.transactionId
    || String(verified?.currency || '').toUpperCase() !== String(currency).toUpperCase()
  ) {
    return false;
  }

  try {
    return toMinorUnits(verified.amount) === toMinorUnits(payment.amount);
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export async function verifyAndApplyChapaPayment({
  prisma,
  txRef,
  secretKey,
  currency,
  fetchImpl,
}) {
  const payment = await prisma.payment.findFirst({
    where: { provider: 'CHAPA', transactionId: txRef },
    include: { order: true },
  });
  if (!payment) return { paymentStatus: 'NOT_FOUND', orderStatus: 'NOT_FOUND', verified: false };
  if (payment.status === 'PAID') {
    const orderStatus = await confirmOrderForPaidPayment(prisma, payment.orderId);
    return { paymentStatus: 'PAID', orderStatus, verified: true, alreadyPaid: true };
  }
  if (payment.status !== 'PENDING' || payment.order.status !== 'PENDING') {
    return { paymentStatus: payment.status, orderStatus: payment.order.status, verified: false };
  }

  const verified = await verifyChapaTransaction({ secretKey, txRef, fetchImpl });
  if (!transactionMatchesOrder(verified, payment, currency)) {
    return { paymentStatus: 'PENDING', orderStatus: payment.order.status, verified: false };
  }

  return prisma.$transaction(async (tx) => {
    const updatedPayment = await tx.payment.updateMany({
      where: {
        orderId: payment.orderId,
        provider: 'CHAPA',
        transactionId: txRef,
        status: 'PENDING',
      },
      data: { status: 'PAID' },
    });
    if (updatedPayment.count === 0) {
      const currentPayment = await tx.payment.findUnique({ where: { orderId: payment.orderId } });
      const currentOrder = await tx.order.findUnique({ where: { id: payment.orderId } });
      const alreadyPaid = currentPayment?.provider === 'CHAPA'
        && currentPayment.status === 'PAID'
        && currentPayment.transactionId === txRef;
      if (alreadyPaid) {
        const orderStatus = await confirmOrderWithinTransaction(tx, payment.orderId);
        return {
          paymentStatus: 'PAID',
          orderStatus,
          verified: true,
          alreadyPaid: true,
        };
      }
      return {
        paymentStatus: currentPayment?.status || 'PENDING',
        orderStatus: currentOrder?.status || 'NOT_FOUND',
        verified: false,
        alreadyPaid: false,
      };
    }

    const orderStatus = await confirmOrderWithinTransaction(tx, payment.orderId);
    return { paymentStatus: 'PAID', orderStatus, verified: true, alreadyPaid: false };
  });
}

async function confirmOrderWithinTransaction(tx, orderId) {
  await tx.order.updateMany({
    where: { id: orderId, status: 'PENDING' },
    data: { status: 'CONFIRMED' },
  });
  const order = await tx.order.findUnique({ where: { id: orderId } });
  return order?.status || 'NOT_FOUND';
}

async function confirmOrderForPaidPayment(prisma, orderId) {
  return prisma.$transaction((tx) => confirmOrderWithinTransaction(tx, orderId));
}
