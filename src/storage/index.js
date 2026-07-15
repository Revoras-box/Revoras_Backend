import { R2StorageProvider } from "./providers/R2StorageProvider.js";

/**
 * The single place that picks the active storage backend. Everything else
 * (MediaService, and transitively controllers) imports `storageProvider`
 * from here and only ever calls methods defined on StorageProvider -
 * switching to S3, DigitalOcean Spaces, or MinIO later means writing one new
 * *StorageProvider class and changing the line below, nothing else.
 */
export const storageProvider = new R2StorageProvider();
