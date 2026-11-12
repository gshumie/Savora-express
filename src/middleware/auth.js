import { prisma } from '../db/prisma.js';
import { verifyToken } from '../lib/auth.js';
import { findActiveAuthSession } from '../services/authSessions.js';

export function extractAuthToken(req) {
  if (!req) return null;
  const header = req.headers?.authorization || '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  const cookieHeader = req.headers?.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)(?:savora_token|token)=([^;]+)/);
    if (match) {
      return decodeURIComponent(match[1]).trim();
    }
  }
  return null;
}

export function createRequireAuth({
  database = prisma,
  tokenVerifier = verifyToken,
  now = () => new Date(),
} = {}) {
  return async function requireAuthMiddleware(req, res, next) {
    const token = extractAuthToken(req);

    if (!token) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    let payload;
    try {
      payload = tokenVerifier(token);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    if (
      typeof payload?.userId !== 'string'
      || typeof payload?.sid !== 'string'
      || payload.sid.length === 0
    ) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    let authSession;
    try {
      authSession = await findActiveAuthSession(
        database,
        payload.sid,
        payload.userId,
        now(),
      );
    } catch {
      console.error('Authentication session validation failed.');
      return res.status(503).json({ error: 'Authentication is temporarily unavailable.' });
    }

    if (!authSession?.user) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }

    req.user = authSession.user;
    req.authSession = { id: authSession.id, userId: authSession.userId };
    return next();
  };
}

export const requireAuth = createRequireAuth();

export function createOptionalAuth({
  database = prisma,
  tokenVerifier = verifyToken,
  now = () => new Date(),
} = {}) {
  return async function optionalAuthMiddleware(req, res, next) {
    const token = extractAuthToken(req);
    if (!token) {
      req.user = null;
      req.authSession = null;
      return next();
    }

    let payload;
    try {
      payload = tokenVerifier(token);
    } catch {
      req.user = null;
      req.authSession = null;
      return next();
    }

    if (
      typeof payload?.userId !== 'string'
      || typeof payload?.sid !== 'string'
      || payload.sid.length === 0
    ) {
      req.user = null;
      req.authSession = null;
      return next();
    }

    try {
      const authSession = await findActiveAuthSession(
        database,
        payload.sid,
        payload.userId,
        now(),
      );
      if (authSession?.user) {
        req.user = authSession.user;
        req.authSession = { id: authSession.id, userId: authSession.userId };
      } else {
        req.user = null;
        req.authSession = null;
      }
    } catch {
      req.user = null;
      req.authSession = null;
    }

    return next();
  };
}

export const optionalAuth = createOptionalAuth();

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  return next();
}
