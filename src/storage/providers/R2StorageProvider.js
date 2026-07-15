import crypto from "crypto";
import path from "path";
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

  generateObjectKey({ folder, filename, entityId, prefix }) {
    const ext = path.extname(filename || "").toLowerCase();
    const uniqueName = [prefix, crypto.randomUUID()].filter(Boolean).join("-") + ext;
    return [folder, entityId, uniqueName].filter(Boolean).join("/");
  }
}
