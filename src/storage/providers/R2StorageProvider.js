import crypto from "crypto";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { StorageProvider } from "../StorageProvider.js";
import { r2Client } from "../../config/r2.js";
import { logger } from "../../utils/logger.js";
import { ServiceError } from "../../utils/ServiceError.js";

/**
 * Cloudflare R2 implementation of StorageProvider, via the S3-compatible
 * AWS SDK v3 client (config/r2.js). Every future provider (plain S3,
 * DigitalOcean Spaces, MinIO for local dev) implements this same shape.
 */
export class R2StorageProvider extends StorageProvider {
  constructor() {
    super();
    this.bucket = process.env.R2_BUCKET_NAME;
    this.baseUrl = (process.env.MEDIA_BASE_URL || "").replace(/\/+$/, "");
  }

  #assertConfigured() {
    if (!r2Client || !this.bucket || !this.baseUrl) {
      throw new ServiceError(503, "Media storage is not configured on this server yet");
    }
  }

  async upload({ buffer, key, mimeType }) {
    this.#assertConfigured();

    await r2Client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
      })
    );

    return { key, url: this.getPublicUrl(key) };
  }

  async delete(key) {
    this.#assertConfigured();
    if (!key) return;

    await r2Client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async replace({ oldKey, buffer, key, mimeType }) {
    const result = await this.upload({ buffer, key, mimeType });

    if (oldKey && oldKey !== key) {
      try {
        await this.delete(oldKey);
      } catch (err) {
        // The new object is already live and the caller is about to persist
        // its key/URL - an orphaned old object is a cleanup nuisance, not a
        // reason to fail the request.
        logger.warn("Failed to delete replaced media object", { oldKey, error: err.message });
      }
    }

    return result;
  }

  getPublicUrl(key) {
    if (!this.baseUrl) {
      throw new ServiceError(503, "Media storage is not configured on this server yet");
    }
    return `${this.baseUrl}/${key}`;
  }

  /**
   * The extension is supplied by MediaService from the file type it verified
   * against the actual bytes; it used to be `path.extname(originalFilename)`,
   * i.e. taken straight from the uploader.
   *
   * It is checked again here against a fixed set rather than merely
   * pattern-matched, because "looks like an extension" is not the property
   * that matters - ".php" and ".html" look exactly like extensions. Object
   * storage doesn't execute anything, but the extension is what a CDN, an
   * origin server, or a future migration off R2 will infer a Content-Type
   * from, and that inference is where an unexpected one turns into a served
   * script. Anything unrecognized gets no extension at all rather than being
   * trusted.
   *
   * `prefix`/`entityId` are internal values, never request input, but are
   * sanitized anyway so a future caller passing something through less
   * carefully can't produce a key that escapes its folder.
   */
  static #SAFE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".pdf"]);

  generateObjectKey({ folder, extension, entityId, prefix }) {
    // Strips path separators AND dots: these are single key segments, so a dot
    // has no legitimate role in them and "../.." must not survive in any form.
    const safe = (value) => String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "");

    const candidate = String(extension || "").toLowerCase();
    const ext = R2StorageProvider.#SAFE_EXTENSIONS.has(candidate) ? candidate : "";

    const uniqueName = [safe(prefix), crypto.randomUUID()].filter(Boolean).join("-") + ext;
    return [safe(folder), safe(entityId), uniqueName].filter(Boolean).join("/");
  }
}
