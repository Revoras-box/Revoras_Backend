/**
 * Rate limiter using in-memory store
 * For production, use Redis-based rate limiting
 */

const requestCounts = new Map();

// Clean up old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of requestCounts.entries()) {
    if (now - data.windowStart > 60000) {
      requestCounts.delete(key);
    }
  }
}, 300000);

/**
 * Create rate limiter middleware
 * @param {Object} options - Rate limit options
 * @param {number} options.windowMs - Time window in milliseconds (default: 60000)
 * @param {number} options.max - Maximum requests per window (default: 100)
 * @param {string} options.message - Error message when limit exceeded
 */
export const rateLimit = (options = {}) => {
  const windowMs = options.windowMs || 60000;
  const max = options.max || 100;
  const message = options.message || "Too many requests, please try again later";

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    let data = requestCounts.get(key);

    if (!data || now - data.windowStart > windowMs) {
      data = { count: 1, windowStart: now };
      requestCounts.set(key, data);
    } else {
      data.count++;
    }

    // Set rate limit headers
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, max - data.count));
    res.setHeader("X-RateLimit-Reset", new Date(data.windowStart + windowMs).toISOString());

    if (data.count > max) {
      return res.status(429).json({ 
        error: message,
        retryAfter: Math.ceil((data.windowStart + windowMs - now) / 1000)
      });
    }

    next();
  };
};

// Pre-configured rate limiters
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per 15 minutes
  message: "Too many login attempts, please try again in 15 minutes"
});

export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: "Rate limit exceeded"
});

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10 requests per minute for sensitive endpoints
  message: "Too many requests to this endpoint"
});
