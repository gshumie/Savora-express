import net from 'node:net';
import rateLimit from 'express-rate-limit';

/**
 * Formats an 8-hextet IPv6 network address into canonical RFC 5952 representation
 * with the longest run of consecutive zeroes compressed with '::'.
 *
 * @param {number[]} full - Array of 8 16-bit integers (words 0..7).
 * @returns {string} Canonical IPv6 /64 CIDR string.
 */
function formatIpv6Prefix(full) {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < 8; i++) {
    if (full[i] === 0) {
      if (curStart === -1) {
        curStart = i;
        curLen = 1;
      } else {
        curLen++;
      }
    } else {
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
      curStart = -1;
      curLen = 0;
    }
  }
  if (curLen > bestLen) {
    bestLen = curLen;
    bestStart = curStart;
  }

  let formatted = '';
  if (bestLen > 1) {
    const head = full.slice(0, bestStart).map((n) => n.toString(16)).join(':');
    const tail = full.slice(bestStart + bestLen).map((n) => n.toString(16)).join(':');
    formatted = `${head || ''}::${tail || ''}`;
  } else {
    formatted = full.map((n) => n.toString(16)).join(':');
  }

  return `${formatted}/64`;
}

/**
 * Normalizes an IP string into a canonical rate-limiting key:
 * - IPv4: Canonical dotted decimal (e.g., '203.0.113.195').
 * - IPv4-mapped IPv6: Equivalent IPv4 string (both dotted decimal like '::ffff:192.0.2.128'
 *   and hexadecimal like '::ffff:c000:0280' resolve to '192.0.2.128').
 * - IPv6: Stable /64 network prefix (e.g., '2001:db8::/64').
 * - Malformed, invalid, or empty strings: Returns null.
 *
 * Built entirely with Node.js built-in modules (no transitive or third-party dependencies).
 *
 * @param {string} rawIp
 * @returns {string|null}
 */
export function normalizeIpAddress(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return null;
  const trimmed = rawIp.trim();
  if (!net.isIP(trimmed)) return null;

  if (net.isIPv4(trimmed)) {
    const parts = trimmed.split('.').map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
      return null;
    }
    return parts.join('.');
  }

  // IPv6 handling
  const lower = trimmed.toLowerCase();

  // Convert embedded dotted-decimal IPv4 representation at the tail if present
  // (e.g., '::ffff:192.0.2.128' or '0:0:0:0:0:ffff:192.0.2.128')
  const lastColon = lower.lastIndexOf(':');
  const lastPart = lower.slice(lastColon + 1);
  let expandedLower = lower;
  if (lastPart.includes('.')) {
    if (!net.isIPv4(lastPart)) return null;
    const ipv4Parts = lastPart.split('.').map(Number);
    const w1 = ((ipv4Parts[0] << 8) | ipv4Parts[1]).toString(16);
    const w2 = ((ipv4Parts[2] << 8) | ipv4Parts[3]).toString(16);
    const prefix = lower.slice(0, lastColon);
    expandedLower = `${prefix}:${w1}:${w2}`;
  }

  let hextets = [];
  if (expandedLower.includes('::')) {
    const [head, tail] = expandedLower.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const missing = 8 - (headParts.length + tailParts.length);
    if (missing < 1) return null;
    hextets = [...headParts, ...Array(missing).fill('0'), ...tailParts];
  } else {
    hextets = expandedLower.split(':');
  }

  if (hextets.length !== 8) return null;
  const numbers = hextets.map((h) => parseInt(h, 16));
  if (numbers.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;

  // Check for IPv4-mapped IPv6 (RFC 4291 §2.5.5.2):
  // First 5 words are 0, 6th word is 0xffff
  const isZeroPrefix = numbers.slice(0, 5).every((n) => n === 0);
  const isFfff6th = numbers[5] === 0xffff;
  if (isZeroPrefix && isFfff6th) {
    const w1 = numbers[6];
    const w2 = numbers[7];
    const b1 = (w1 >> 8) & 0xff;
    const b2 = w1 & 0xff;
    const b3 = (w2 >> 8) & 0xff;
    const b4 = w2 & 0xff;
    return [b1, b2, b3, b4].join('.');
  }

  // General IPv6: mask host bits (words 4..7) to zero for /64 network key
  const networkHextets = [...numbers.slice(0, 4), 0, 0, 0, 0];
  return formatIpv6Prefix(networkHextets);
}

/**
 * Resolves the client IP for rate limiting and security enforcement.
 *
 * Vercel Deployment Assumption:
 * This implementation relies on the 'x-vercel-forwarded-for' header populated by
 * Vercel's edge routing infrastructure when Vercel directly terminates client traffic.
 * Note: If an upstream reverse proxy or CDN (e.g., Cloudflare) is positioned in front of Vercel
 * without configuring Vercel's trusted proxy headers, this header could reflect the intermediate
 * proxy IP rather than the originating client IP. It is therefore not universally safe if another
 * untrusted proxy sits in front of Vercel.
 *
 * Security Requirements:
 * - Express 'trust proxy' MUST remain disabled.
 * - In production (NODE_ENV=production OR VERCEL=1), resolve client IP only from
 *   the single 'x-vercel-forwarded-for' header.
 * - Reject missing, malformed, array-valued, comma-separated, or ambiguous header values.
 *   Never select the first IP from a comma-separated list.
 * - In non-production environments (development and test), preserve safe fallback behavior
 *   using req.ip or socket address.
 *
 * @param {import('express').Request} req
 * @returns {string|null} Normalized IP key, or null if unverified in production.
 */
export function resolveClientIp(req) {
  const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
  const rawHeader = req.headers ? req.headers['x-vercel-forwarded-for'] : undefined;

  // Reject ambiguous, array-valued, or comma-separated header values.
  const isMultiple = Array.isArray(rawHeader) || (typeof rawHeader === 'string' && rawHeader.includes(','));
  if (isMultiple) {
    return isProduction ? null : resolveFallbackIp(req);
  }

  const candidate = (!isMultiple && typeof rawHeader === 'string') ? rawHeader.trim() : null;
  const normalized = candidate ? normalizeIpAddress(candidate) : null;

  if (isProduction) {
    // In production, use only x-vercel-forwarded-for. Never fall back to req.ip.
    return normalized;
  }

  // Non-production fallback for development and automated test suites
  if (normalized) {
    return normalized;
  }

  return resolveFallbackIp(req);
}

function resolveFallbackIp(req) {
  const fallback = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
  return normalizeIpAddress(fallback) || (typeof fallback === 'string' ? fallback.trim() : '127.0.0.1');
}

/**
 * Creates a rate limiter middleware wrapper using resolveClientIp.
 * Ensures that if production IP resolution fails, a controlled HTTP 503 response
 * is returned immediately without touching the rate-limiting store or sharing a fallback bucket.
 *
 * @param {object} options
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiterMiddleware({
  windowMs = 15 * 60 * 1000,
  max = 200,
  message = { error: 'Too many requests. Please try again later.' },
  serviceUnavailableMessage = { error: 'Service temporarily unavailable. Please try again later.' },
  ...options
} = {}) {
  const limiter = rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { trustProxy: false, ...options.validate },
    keyGenerator: (req) => req.resolvedClientIp,
    message,
    handler: (req, res, _next, opts) => {
      res.status(opts.statusCode).json(opts.message);
    },
    ...options,
  });

  return (req, res, next) => {
    let clientIp = null;
    try {
      clientIp = resolveClientIp(req);
    } catch {
      clientIp = null;
    }

    if (!clientIp) {
      return res.status(503).json(serviceUnavailableMessage);
    }

    req.resolvedClientIp = clientIp;
    return limiter(req, res, next);
  };
}
