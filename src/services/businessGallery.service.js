import * as galleryRepo from "../repositories/businessGallery.repository.js";
import * as mediaService from "./media.service.js";
import { ServiceError } from "../utils/ServiceError.js";

const MAX_GALLERY_IMAGES = 20;

export const listGallery = (studioId) => galleryRepo.list(studioId);

/**
 * Phase 1.1 (report.md V4 roadmap): second real MediaService caller after
 * the business logo (report.md Phase 0.1 plan), same shape - validate,
 * delegate to MediaService, persist only the returned URL. The first image
 * a business uploads becomes the cover automatically; later ones don't
 * disturb the existing cover unless the caller explicitly sets one.
 */
export const addGalleryImage = async (studioId, file) => {
  if (!file) {
    throw new ServiceError(400, "No file uploaded");
  }

  const existingCount = await galleryRepo.count(studioId);
  if (existingCount >= MAX_GALLERY_IMAGES) {
    throw new ServiceError(400, `Gallery is limited to ${MAX_GALLERY_IMAGES} images`);
  }

  const { url } = await mediaService.uploadMedia({
    buffer: file.buffer,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    folder: mediaService.MEDIA_FOLDERS.BUSINESSES,
    entityId: studioId,
    prefix: "gallery",
  });

  const nextSortOrder = (await galleryRepo.maxSortOrder(studioId)) + 1;

  return galleryRepo.create({
    studio_id: studioId,
    url,
    sort_order: nextSortOrder,
    is_cover: existingCount === 0,
  });
};

export const removeGalleryImage = async (studioId, imageId) => {
  const image = await galleryRepo.findById(imageId, studioId);
  if (!image) {
    throw new ServiceError(404, "Gallery image not found");
  }

  await mediaService.deleteMediaByUrl(image.url);
  await galleryRepo.remove(imageId, studioId);

  // Removing the cover image leaves the gallery with no cover - promote
  // whichever image is now first rather than surfacing that as a caller
  // concern (a gallery with images but no cover is just a bug from the
  // frontend's perspective).
  if (image.is_cover) {
    const remaining = await galleryRepo.list(studioId);
    if (remaining.length > 0) {
      await galleryRepo.setCover(remaining[0].id, studioId);
    }
  }

  return listGallery(studioId);
};

/**
 * Full replace of the ordering, not a delta - simplest contract for a
 * drag-and-drop reorder UI ("here is the new order") and avoids the
 * ambiguity of partial position updates when the caller doesn't send every
 * image's new position.
 */
export const reorderGallery = async (studioId, orderedImageIds) => {
  const existing = await galleryRepo.list(studioId);
  const orderedIds = new Set(orderedImageIds);

  // Must be a permutation of the current gallery: same count, no duplicates,
  // and every existing image present. Checking length + membership alone lets
  // a duplicated id stand in for a missing one (same length, every id "known"),
  // which leaves the missing image with a stale sort_order and a collision.
  if (
    orderedImageIds.length !== existing.length ||
    orderedIds.size !== orderedImageIds.length ||
    !existing.every((img) => orderedIds.has(img.id))
  ) {
    throw new ServiceError(400, "orderedImageIds must match this business's current gallery images exactly");
  }

  await galleryRepo.runInTransaction(async (trx) => {
    for (const [index, imageId] of orderedImageIds.entries()) {
      await galleryRepo.updateSortOrder(imageId, studioId, index, trx);
    }
  });

  return listGallery(studioId);
};

export const setCoverImage = async (studioId, imageId) => {
  const image = await galleryRepo.findById(imageId, studioId);
  if (!image) {
    throw new ServiceError(404, "Gallery image not found");
  }

  await galleryRepo.runInTransaction(async (trx) => {
    await galleryRepo.unsetCover(studioId, trx);
    await galleryRepo.setCover(imageId, studioId, trx);
  });

  return listGallery(studioId);
};
