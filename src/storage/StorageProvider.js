/**
 * Contract every storage backend (R2, S3, DigitalOcean Spaces, MinIO, ...)
 * must implement. MediaService and controllers depend only on this shape,
 * never on a concrete provider or an SDK - swapping backends means writing
 * one new class here and pointing storage/index.js at it, nothing else in
 * the app changes.
 *
 * Not a TS interface (this codebase is plain JS) - a base class whose
 * methods throw unless overridden, so a provider that forgets one fails
 * immediately and loudly instead of silently no-op-ing.
 */
export class StorageProvider {
  /**
   * @param {{ buffer: Buffer, key: string, mimeType: string }} params
   * @returns {Promise<{ key: string, url: string }>}
   */
  async upload(_params) {
    throw new Error(`${this.constructor.name} must implement upload()`);
  }

  /**
   * @param {string} _key
   * @returns {Promise<void>}
   */
  async delete(_key) {
    throw new Error(`${this.constructor.name} must implement delete()`);
  }

  /**
   * Uploads a new object and removes the one it replaces. Old-key deletion
   * failures must not fail the whole operation - the new file is already
   * live and callers have already persisted its key/URL by the time cleanup
   * of the old object would matter.
   * @param {{ oldKey: string|null|undefined, buffer: Buffer, key: string, mimeType: string }} params
   * @returns {Promise<{ key: string, url: string }>}
   */
  async replace(_params) {
    throw new Error(`${this.constructor.name} must implement replace()`);
  }

  /**
   * @param {string} _key
   * @returns {string}
   */
  getPublicUrl(_key) {
    throw new Error(`${this.constructor.name} must implement getPublicUrl()`);
  }

  /**
   * @param {{ folder: string, filename: string, entityId?: string, prefix?: string }} params
   * @returns {string}
   */
  generateObjectKey(_params) {
    throw new Error(`${this.constructor.name} must implement generateObjectKey()`);
  }
}
