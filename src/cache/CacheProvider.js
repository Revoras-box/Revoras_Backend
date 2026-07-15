/**
 * Contract every cache backend (in-memory, Redis, ...) must implement.
 * CacheService and callers depend only on this shape, never on a concrete
 * backend - swapping in-memory for Redis (or Redis for something else
 * later) means writing one new class here and pointing cache/index.js at
 * it, nothing else in the app changes.
 */
export class CacheProvider {
  /**
   * @param {string} _key
   * @returns {Promise<any|undefined>} undefined on a miss
   */
  async get(_key) {
    throw new Error(`${this.constructor.name} must implement get()`);
  }

  /**
   * @param {string} _key
   * @param {any} _value
   * @param {number} _ttlSeconds
   * @returns {Promise<void>}
   */
  async set(_key, _value, _ttlSeconds) {
    throw new Error(`${this.constructor.name} must implement set()`);
  }

  /**
   * @param {string} _key
   * @returns {Promise<void>}
   */
  async del(_key) {
    throw new Error(`${this.constructor.name} must implement del()`);
  }

  /**
   * Backend-agnostic on top of get/set - a cache miss calls `compute`,
   * caches the result, and returns it. Subclasses don't need to (and
   * shouldn't) override this; it's the same logic regardless of backend.
   * @param {string} key
   * @param {number} ttlSeconds
   * @param {() => Promise<any>} compute
   */
  async getOrSet(key, ttlSeconds, compute) {
    const cached = await this.get(key);
    if (cached !== undefined) return cached;

    const value = await compute();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
