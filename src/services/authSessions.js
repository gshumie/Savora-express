import { AUTH_SESSION_TTL_SECONDS } from '../lib/auth.js';

const userSelection = {
  id: true,
  name: true,
  email: true,
  role: true,
};

export async function createAuthSession(database, userId, now = new Date()) {
  return database.authSession.create({
    data: {
      userId,
      expiresAt: new Date(now.getTime() + AUTH_SESSION_TTL_SECONDS * 1000),
    },
  });
}

export async function findActiveAuthSession(database, sessionId, userId, now = new Date()) {
  return database.authSession.findFirst({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
      expiresAt: { gt: now },
    },
    include: {
      user: { select: userSelection },
    },
  });
}

export async function revokeAuthSession(database, sessionId, userId, now = new Date()) {
  return database.authSession.updateMany({
    where: {
      id: sessionId,
      userId,
      revokedAt: null,
    },
    data: { revokedAt: now },
  });
}
