import { storageProvider } from "../storage/index.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Every folder a caller is allowed to upload into. Adding a new feature
 * area (e.g. a future "portfolios" or "certificates" upload) means adding
 * one line here - no other change to this file or to StorageProvider.
 */
export const MEDIA_FOLDERS = Object.freeze({
  BUSINESSES: "businesses",
  PROFESSIONALS: "professionals",
  SERVICES: "services",
  OFFERS: "offers",
  REVIEWS: "reviews",
  CERTIFICATES: "certificates",
  PORTFOLIOS: "portfolios",
  VERIFICATION: "verification",
  DOCUMENTS: "documents",
});

const ALLOWED_FOLDERS = new Set(Object.values(MEDIA_FOLDERS));

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

// Business documents (PAN / GST / other) are commonly scans or PDFs, not just
// photos - callers uploading those pass this wider set explicitly.
export const DOCUMENT_MIME_TYPES = new Set([...ALLOWED_IMAGE_MIME_TYPES, "application/pdf"]);

const MAX_FILE_SIZE_BYTES = (Number(process.env.MEDIA_MAX_FILE_SIZE_MB) || 5) * 1024 * 1024;

const assertValidFile = ({ folder, mimeType, size }, allowedMimeTypes = ALLOWED_IMAGE_MIME_TYPES) => {
  if (!ALLOWED_FOLDERS.has(folder)) {
    throw new ServiceError(400, `Unknown media folder: ${folder}`);
  }
  if (!allowedMimeTypes.has(mimeType)) {
    throw new ServiceError(400, `Unsupported file type: ${mimeType}`);
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new ServiceError(400, `File too large - max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
  }
};

/**
 * Strips the CDN base URL off a previously-uploaded media URL to recover its
 * object key, for records (e.g. businesses.logo_url) that only persist the
 * public URL. Returns null for anything that isn't one of our own media
 * URLs (nothing to delete/replace on our storage backend).
 */
export const getKeyFromUrl = (url) => {
  const baseUrl = (process.env.MEDIA_BASE_URL || "").replace(/\/+$/, "");
  if (!url || !baseUrl || !url.startsWith(`${baseUrl}/`)) return null;
  return url.slice(baseUrl.length + 1);
};

/**
 * Uploads a single file into the given folder. This is the only path any
 * feature (business logos/galleries, professional portfolios, service
 * photos, offers, reviews, certificates, ...) should use to reach storage -
 * controllers and services must never call the storage provider or the AWS
 * SDK directly.
 * @param {{ buffer: Buffer, originalFilename: string, mimeType: string, size: number, folder: string, entityId?: string, prefix?: string }} params
 */
export const uploadMedia = async ({ buffer, originalFilename, mimeType, size, folder, entityId, prefix, allowedMimeTypes }) => {
  assertValidFile({ folder, mimeType, size }, allowedMimeTypes);

  const key = storageProvider.generateObjectKey({ folder, filename: originalFilename, entityId, prefix });
  return storageProvider.upload({ buffer, key, mimeType });
};

/**
 * Uploads a new file and removes whichever previous object `previousUrl`
 * pointed at (if any). Use this for single-slot media - a logo, a cover
 * photo - where the old file should not be left orphaned in the bucket.
 * @param {{ buffer: Buffer, originalFilename: string, mimeType: string, size: number, folder: string, entityId?: string, prefix?: string, previousUrl?: string }} params
 */
export const replaceMedia = async ({
  buffer,
  originalFilename,
  mimeType,
  size,
  folder,
  entityId,
  prefix,
  previousUrl,
}) => {
  assertValidFile({ folder, mimeType, size });

  const key = storageProvider.generateObjectKey({ folder, filename: originalFilename, entityId, prefix });
  const oldKey = getKeyFromUrl(previousUrl);
  return storageProvider.replace({ oldKey, buffer, key, mimeType });
};

export const deleteMediaByUrl = async (url) => {
  const key = getKeyFromUrl(url);
  if (!key) return;
  await storageProvider.delete(key);
};
