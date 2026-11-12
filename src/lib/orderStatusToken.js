import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';

const TOKEN_LIFETIME = '7d';

export function createOrderStatusToken(orderNumber, secret) {
  return jwt.sign(
    { orderNumber, purpose: 'payment-status' },
    secret,
    {
      expiresIn: TOKEN_LIFETIME,
      jwtid: randomBytes(32).toString('base64url'),
    },
  );
}

export function isValidOrderStatusToken(token, orderNumber, secret) {
  if (typeof token !== 'string' || typeof orderNumber !== 'string') return false;
  try {
    const payload = jwt.verify(token, secret);
    return payload.purpose === 'payment-status' && payload.orderNumber === orderNumber;
  } catch {
    return false;
  }
}
