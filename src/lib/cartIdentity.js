export function normalizeGuestSessionId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const sessionId = value.trim();
  return sessionId || null;
}
