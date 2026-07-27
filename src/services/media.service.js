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

/**
 * Leading bytes that identify each format we accept, and the canonical file
 * extension we store it under.
 *
 * `mimeType` arrives as multer's `file.mimetype`, which is simply the
 * Content-Type the *client* typed into the multipart part - it is a claim, not
 * a fact, and costs nothing to forge. Checking it alone means the allowlist
 * above only stops honest callers: anything at all can be uploaded by
 * labelling it `image/png`.
 *
 * Whether that matters depends on what serves the bucket, which is exactly why
 * it is worth closing here rather than reasoning about elsewhere - today the
 * stored Content-Type comes from the same forged claim, and any future signed
 * URL, image pipeline, or migration to origin-served media inherits whatever
 * we let through. Verifying the actual bytes makes the allowlist mean what it
 * says.
 *
 * @see https://www.iana.org/assignments/media-types/media-types.xhtml
 */
const FILE_SIGNATURES = {
  "image/jpeg": { extension: ".jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/png": {
    extension: ".png",
    matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  "image/gif": { extension: ".gif", matches: (b) => b.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/) !== null },
  // RIFF container: "RIFF" <4-byte size> "WEBP"
  "image/webp": {
    extension: ".webp",
    matches: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
  // ISO base media file format: <4-byte box size> "ftyp" <brand>
  "image/avif": {
    extension: ".avif",
    matches: (b) => b.subarray(4, 8).toString("ascii") === "ftyp" && b.subarray(8, 12).toString("ascii").startsWith("avi"),
  },
  "application/pdf": { extension: ".pdf", matches: (b) => b.subarray(0, 5).toString("ascii") === "%PDF-" },
};

/** Longest signature we inspect, so a truncated file is rejected rather than crashing. */
const SIGNATURE_BYTES = 12;

const assertValidFile = ({ folder, mimeType, size, buffer }, allowedMimeTypes = ALLOWED_IMAGE_MIME_TYPES) => {
  if (!ALLOWED_FOLDERS.has(folder)) {
    throw new ServiceError(400, `Unknown media folder: ${folder}`);
  }
  if (!allowedMimeTypes.has(mimeType)) {
    throw new ServiceError(400, `Unsupported file type: ${mimeType}`);
  }
  if (size > MAX_FILE_SIZE_BYTES) {
    throw new ServiceError(400, `File too large - max ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB`);
  }

  const signature = FILE_SIGNATURES[mimeType];
  if (!signature) {
    // An allowlisted type with no signature entry is a bug in this file, not a
    // bad upload - fail closed rather than waving it through unverified.
    throw new ServiceError(400, `Unsupported file type: ${mimeType}`);
  }
  if (!Buffer.isBuffer(buffer) || buffer.length < SIGNATURE_BYTES || !signature.matches(buffer)) {
    throw new ServiceError(400, `File contents do not match the declared type (${mimeType})`);
  }

  return signature.extension;
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
 * Callers may still pass the uploader's `originalFilename`; it is accepted and
 * ignored. Nothing derived from it reaches the stored object.
 *
 * @param {{ buffer: Buffer, mimeType: string, size: number, folder: string, entityId?: string, prefix?: string }} params
 */
export const uploadMedia = async ({ buffer, mimeType, size, folder, entityId, prefix, allowedMimeTypes }) => {
  // The extension comes back from validation - i.e. from the bytes we actually
  // verified - rather than from originalFilename, which is attacker-controlled
  // and used to land verbatim in the stored object key.
  const extension = assertValidFile({ folder, mimeType, size, buffer }, allowedMimeTypes);

  const key = storageProvider.generateObjectKey({ folder, extension, entityId, prefix });
  return storageProvider.upload({ buffer, key, mimeType });
};

/**
 * Uploads a new file and removes whichever previous object `previousUrl`
 * pointed at (if any). Use this for single-slot media - a logo, a cover
 * photo - where the old file should not be left orphaned in the bucket.
 * @param {{ buffer: Buffer, mimeType: string, size: number, folder: string, entityId?: string, prefix?: string, previousUrl?: string }} params
 */
export const replaceMedia = async ({
  buffer,
  mimeType,
  size,
  folder,
  entityId,
  prefix,
  previousUrl,
}) => {
  const extension = assertValidFile({ folder, mimeType, size, buffer });

  const key = storageProvider.generateObjectKey({ folder, extension, entityId, prefix });
  const oldKey = getKeyFromUrl(previousUrl);
  return storageProvider.replace({ oldKey, buffer, key, mimeType });
};

export const deleteMediaByUrl = async (url) => {
  const key = getKeyFromUrl(url);
  if (!key) return;
  await storageProvider.delete(key);
};
