import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { config } from '../config.js';

export const AUTH_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DUMMY_PASSWORD_HASH = '$2b$12$/A6ZcUdA0CqjgmuGHa7dfOq41Hz2hbKomvEZ4JIaLhvlfyQk9g0ni';

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function generateToken(user, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new TypeError('An authentication session ID is required to issue a token.');
  }

  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role, sid: sessionId },
    config.jwtSecret,
    { expiresIn: AUTH_SESSION_TTL_SECONDS },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
