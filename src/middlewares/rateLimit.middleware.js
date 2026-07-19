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
 * Keys an auth attempt by the ACCOUNT being targeted, not the network it came
 * from. Brute force is an attack on one account, so that is what the counter
 * should track: an attacker gets the same small budget wherever they dial in
 * from, and a salon's staff no longer share one budget just by sharing a wifi
 * connection.
 *
 * Falls back to IP when there is no identifier to key on (token-bearing
 * endpoints put theirs in the URL, so those are covered explicitly).
 */
const authTargetOf = (req) => {
  const body = req.body || {};
  const identifier = body.email || body.phone || body.identifier;
  if (identifier) return `acct:${String(identifier).trim().toLowerCase()}`;
  if (req.params?.token) return `token:${req.params.token}`;
  return ipOf(req);
};

/**
 * Create rate limiter middleware
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000)
 * @param {number} options.max - Maximum requests per window (default: 100)
 * @param {string} options.scope - Distinguishes counters between different limiters
 * @param {(req: import('express').Request) => string} options.keyGenerator - Generates a client key
 * @param {boolean} options.skipSuccessfulRequests - Refund the slot when the response is <400
 * @param {string} options.message - Error message when limit exceeded
 */
export const rateLimit = (options = {}) => {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 100;
  const scope = options.scope || "default";
  const keyGenerator = options.keyGenerator || defaultKeyGenerator;
  const skipSuccessfulRequests = options.skipSuccessfulRequests || false;
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

    // Refund the slot when the request turned out to be legitimate. Without
    // this an auth limiter counts SUCCESSFUL logins, so a salon whose staff all
    // sign in from one wifi connection locks itself out during a normal morning
    // - nobody did anything wrong. Re-read from the map rather than mutating
    // the captured `data`: the window may have rolled over and been replaced
    // while the request was in flight, and decrementing the new window's
    // counter would hand out free attempts.
    if (skipSuccessfulRequests) {
      res.on("finish", () => {
        if (res.statusCode >= 400) return;
        const current = requestCounts.get(key);
        if (current && current.windowStart === data.windowStart && current.count > 0) {
          current.count--;
        }
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

/**
 * Guards a single account against password guessing.
 *
 * Previously this was 5 attempts per 15 minutes keyed by IP, counting every
 * request including successful ones. Both halves were wrong. Keyed by IP it
 * punished exactly the wrong people - a salon where the whole team signs in
 * from one connection, or any shared/NAT'd network - while an attacker with a
 * handful of IPs was barely inconvenienced. And counting successes meant five
 * *correct* logins locked the shop out for fifteen minutes.
 *
 * Note this is the second line of defence, not the first: user.repository's
 * `recordFailedLogin` already locks an account after repeated failures, in the
 * database, independent of where the attempts came from. So this limiter does
 * not need to be tight enough to stop a determined attacker on its own - it
 * needs to blunt automated guessing without breaking a real shop's morning.
 * Distributed credential-stuffing across many accounts is `authFloodLimiter`'s
 * job below.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: envMax("RATE_LIMIT_AUTH_MAX", 10),
  scope: "auth",
  keyGenerator: authTargetOf,
  skipSuccessfulRequests: true,
  message: "Too many failed attempts for this account, please try again in 15 minutes"
});

/**
 * The per-IP ceiling for auth endpoints. `authLimiter` above stops one account
 * being guessed; this stops one source working through many accounts, which
 * per-account keying alone would never see.
 *
 * Deliberately generous: it has to sit above a whole salon (or campus, or
 * office behind one NAT) signing in legitimately, so it is a flood ceiling and
 * not a usage budget. Successful requests are refunded here too - a busy
 * morning of correct logins is not an attack.
 */
export const authFloodLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: envMax("RATE_LIMIT_AUTH_FLOOD_MAX", 100),
  scope: "authflood",
  keyGenerator: ipOf,
  skipSuccessfulRequests: true,
  message: "Too many failed attempts from this network, please try again later"
});

/**
 * Signup, not sign-in. Kept separate from `authLimiter` because the two want
 * opposite behaviour on success: a successful login is evidence of legitimacy
 * and gets refunded, whereas a successful registration is precisely the thing
 * being abused when someone mass-creates accounts. So this one counts every
 * request, and keys by IP - there is no account to key by yet.
 *
 * The cap is per hour rather than per 15 minutes because signing up is rare:
 * even a shop registering its owner and a few staff by hand stays well under
 * it, while scripted account creation does not.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: envMax("RATE_LIMIT_REGISTER_MAX", 10),
  scope: "register",
  keyGenerator: ipOf,
  message: "Too many accounts created from this network, please try again later"
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
