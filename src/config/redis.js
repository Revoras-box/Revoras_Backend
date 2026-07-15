import Redis from "ioredis";
import { logger } from "../utils/logger.js";

/**
 * Mirrors config/razorpay.js and config/r2.js: export null when unconfigured
 * so the app boots fine without Redis (nothing in this codebase requires it
 * to start), and let cache/index.js fall back to the in-memory provider.
 * `lazyConnect` + a swallowed 'error' listener keep an unreachable Redis
 * from crashing the process - CacheProvider callers already treat cache
 * misses/failures as "go compute it yourself", not a hard dependency.
 */
export const redisClient = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 })
  : null;

if (redisClient) {
  redisClient.on("error", (err) => {
    logger.warn("Redis connection error", { error: err.message });
  });
}

export const isRedisConfigured = () => redisClient !== null;
