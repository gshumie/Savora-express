import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { config } from '../config.js';

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function generateToken(user) {
  return jwt.sign(
    { userId: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: '7d' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
