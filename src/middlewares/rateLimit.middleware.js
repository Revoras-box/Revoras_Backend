/**
 * Rate limiter using in-memory store
 * For production, use Redis-based rate limiting
 */

const requestCounts = new Map();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now > data.expiresAt) {
      requestCounts.delete(key);
    }
  }
}, 300000);

const ipOf = (req) => req.ip || req.connection?.remoteAddress || "unknown";

/**
 * Keys by the authenticated person when there is one, else by IP.
 *
 * ORDERING MATTERS: this only sees `req.user` if the limiter is mounted AFTER
 * `authenticate`/`optionalAuth`. Mounted before, it silently degrades to
 * per-IP - which lumps every staff member in one salon (or every customer
 * behind a campus NAT) into a single shared bucket. See `floodLimiter` for the
 * limiter that is MEANT to run before auth.
 */
const defaultKeyGenerator = (req) => {
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  return ipOf(req);
};

/**
 * Create rate limiter middleware
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000)
 * @param {number} options.max - Maximum requests per window (default: 100)
 * @param {string} options.scope - Distinguishes counters between different limiters
 * @param {(req: import('express').Request) => string} options.keyGenerator - Generates a client key
 * @param {string} options.message - Error message when limit exceeded
 */
export const rateLimit = (options = {}) => {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 100;
  const scope = options.scope || "default";
  const keyGenerator = options.keyGenerator || defaultKeyGenerator;
  const message = options.message || "Too many requests, please try again later";

  return (req, res, next) => {
    const identifier = keyGenerator(req);
    const key = `${scope}:${identifier}`;
    const now = Date.now();

    let data = requestCounts.get(key);

    if (!data || now > data.expiresAt) {
      data = { count: 1, windowStart: now, expiresAt: now + windowMs };
      requestCounts.set(key, data);
    } else {
      data.count++;
    }

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - data.count));
    res.setHeader("X-RateLimit-Reset", new Date(data.windowStart + windowMs).toISOString());

    if (data.count > max) {
      const retryAfterSeconds = Math.ceil((data.windowStart + windowMs - now) / 1000);
      res.setHeader("Retry-After", retryAfterSeconds);
      return res.status(429).json({
        error: message,
        retryAfter: retryAfterSeconds
      });
    }

    next();
  };
};

/** An env override for a limiter's cap. Absent/invalid falls back to the default. */
const envMax = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

// Pre-configured rate limiters
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: envMax("RATE_LIMIT_AUTH_MAX", 5), // 5 attempts per 15 minutes
  scope: "auth",
  message: "Too many login attempts, please try again in 15 minutes"
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: envMax("RATE_LIMIT_API_MAX", 100), // 100 requests per minute
  scope: "api",
  message: "Rate limit exceeded"
});

/**
 * The pre-auth guard: always keyed by IP, deliberately generous.
 *
 * Mount this BEFORE `authenticate` on routers that were previously fronted by
 * `apiLimiter`, then mount `apiLimiter` AFTER it. That keeps something in front
 * of the JWT verification (so a flood of junk tokens can't spin the CPU freely)
 * while letting the real per-request budget be counted per user, which is what
 * `apiLimiter` was always meant to do.
 *
 * The cap is a flood ceiling, not a usage budget: it has to sit above whatever
 * a whole office or campus behind one NAT does legitimately, so it is set well
 * clear of real traffic (the business dashboard costs single-digit calls per
 * page). If you find yourself lowering this to shape normal usage, shape it
 * with `apiLimiter` instead - that one knows who the user is.
 */
export const floodLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: envMax("RATE_LIMIT_FLOOD_MAX", 600),
  scope: "flood",
  keyGenerator: ipOf,
  message: "Too many requests from this network, please slow down"
});

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20, // 20 requests per minute for sensitive endpoints
  scope: "strict",
  message: "Too many requests to this endpoint"
});
