export function normalizeGuestSessionId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const sessionId = value.trim();
  return sessionId || null;
}

export function extractGuestSessionId(req) {
  if (!req) return null;

  // 1. Header (X-Session-Id or x-session-id)
  const headerSessionId = normalizeGuestSessionId(
    req.headers?.['x-session-id'] || req.headers?.['X-Session-Id'],
  );
  if (headerSessionId) return headerSessionId;

  // 2. Request body sessionId
  const bodySessionId = normalizeGuestSessionId(req.body?.sessionId);
  if (bodySessionId) return bodySessionId;

  // 3. Query parameter sessionId
  const querySessionId = normalizeGuestSessionId(req.query?.sessionId);
  if (querySessionId) return querySessionId;

  // 4. Cookie header (savora_session_id, session_id, sessionId)
  const cookieHeader = req.headers?.cookie;
  if (typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/(?:^|;\s*)(?:savora_session_id|session_id|sessionId)=([^;]+)/);
    if (match) {
      return normalizeGuestSessionId(decodeURIComponent(match[1]));
    }
  }

  return null;
}
