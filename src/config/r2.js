import { S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 is S3-API-compatible, so the same @aws-sdk/client-s3 client
 * used for real S3 works here unchanged - only the endpoint/region differ.
 * Mirrors config/razorpay.js's pattern: export null when unconfigured so the
 * app can still boot (e.g. in dev without media features) instead of
 * crashing, and let callers (R2StorageProvider) fail loudly per-request
 * instead.
 */
export const r2Client =
  process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    ? new S3Client({
        region: "auto",
        endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      })
    : null;

export const isR2Configured = () => r2Client !== null;
