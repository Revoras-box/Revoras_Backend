import { isRedisConfigured } from "../config/redis.js";
import { InMemoryCacheProvider } from "./providers/InMemoryCacheProvider.js";
import { RedisCacheProvider } from "./providers/RedisCacheProvider.js";

/**
 * The single place that picks the active cache backend. Everything else
 * imports `cacheProvider` from here and only ever calls methods defined on
 * CacheProvider - falls back to in-memory automatically when REDIS_URL
 * isn't set (see config/redis.js), and switches to Redis with zero code
 * changes elsewhere the moment it is.
 */
export const cacheProvider = isRedisConfigured() ? new RedisCacheProvider() : new InMemoryCacheProvider();
