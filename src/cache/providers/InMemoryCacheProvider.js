import { CacheProvider } from "../CacheProvider.js";

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Default cache backend when REDIS_URL isn't set - same in-memory-Map-plus-
 * periodic-sweep shape as middlewares/rateLimit.middleware.js. Per-process
 * only (no sharing across instances), which is fine for single-instance dev
 * and for values that are cheap to recompute; swap to Redis for anything
 * that needs to be shared across processes.
 */
export class InMemoryCacheProvider extends CacheProvider {
  constructor() {
    super();
    this.store = new Map();

    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (now > entry.expiresAt) this.store.delete(key);
      }
    }, CLEANUP_INTERVAL_MS);
    timer.unref?.();
  }

  async get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key, value, ttlSeconds) {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key) {
    this.store.delete(key);
  }
}
