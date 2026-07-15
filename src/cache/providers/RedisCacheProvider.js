import { CacheProvider } from "../CacheProvider.js";
import { redisClient } from "../../config/redis.js";
import { logger } from "../../utils/logger.js";

/**
 * Redis-backed implementation, active once REDIS_URL is set. Values are
 * JSON-serialized - callers store plain data (arrays/objects/primitives),
 * not class instances or Buffers.
 *
 * Failures (Redis down, network blip) are logged and treated as a miss/no-op
 * rather than thrown - a cache is an optimization, not a source of truth, so
 * a request should fall through to computing the real value instead of
 * 500ing because the cache was unreachable.
 */
export class RedisCacheProvider extends CacheProvider {
  async get(key) {
    try {
      const raw = await redisClient.get(key);
      return raw === null ? undefined : JSON.parse(raw);
    } catch (err) {
      logger.warn("Redis get failed, treating as cache miss", { key, error: err.message });
      return undefined;
    }
  }

  async set(key, value, ttlSeconds) {
    try {
      await redisClient.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      logger.warn("Redis set failed", { key, error: err.message });
    }
  }

  async del(key) {
    try {
      await redisClient.del(key);
    } catch (err) {
      logger.warn("Redis del failed", { key, error: err.message });
    }
  }
}
