import * as portfolioRepo from "../repositories/portfolio.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as mediaService from "./media.service.js";
import { ServiceError } from "../utils/ServiceError.js";

const MAX_PORTFOLIO_IMAGES = 30;

// Portfolio media is membership-scoped; confirm the member belongs to this
// business before any read/write, so one business can't touch another's media.
const assertMember = async (studioId, memberId) => {
  const member = await businessMemberRepo.findById(memberId);
  if (!member || member.studio_id !== studioId) {
    throw new ServiceError(404, "Professional not found");
  }
};

export const listPortfolio = async (studioId, memberId) => {
  await assertMember(studioId, memberId);
  return portfolioRepo.list(memberId);
};

/**
 * Same shape as Business Gallery's addGalleryImage (report.md Phase 1.1) -
 * validate, delegate to MediaService, persist only the returned URL. First
 * image becomes the cover automatically.
 */
export const addPortfolioImage = async (studioId, memberId, file, caption) => {
  await assertMember(studioId, memberId);
  if (!file) throw new ServiceError(400, "No file uploaded");

  const existingCount = await portfolioRepo.count(memberId);
  if (existingCount >= MAX_PORTFOLIO_IMAGES) {
    throw new ServiceError(400, `Portfolio is limited to ${MAX_PORTFOLIO_IMAGES} images`);
  }

  const { url } = await mediaService.uploadMedia({
    buffer: file.buffer,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    folder: mediaService.MEDIA_FOLDERS.PORTFOLIOS,
    entityId: memberId,
    prefix: "portfolio",
  });

  const nextSortOrder = (await portfolioRepo.maxSortOrder(memberId)) + 1;

  return portfolioRepo.create({
    business_member_id: memberId,
    media_url: url,
    caption: caption || null,
    sort_order: nextSortOrder,
    is_cover: existingCount === 0,
  });
};

export const removePortfolioImage = async (studioId, memberId, imageId) => {
  await assertMember(studioId, memberId);
  const image = await portfolioRepo.findById(imageId, memberId);
  if (!image) throw new ServiceError(404, "Portfolio image not found");

  await mediaService.deleteMediaByUrl(image.media_url);
  await portfolioRepo.remove(imageId, memberId);

  // Deleting the cover leaves the portfolio coverless - promote whatever is now
  // first, same policy as Business Gallery.
  if (image.is_cover) {
    const remaining = await portfolioRepo.list(memberId);
    if (remaining.length > 0) {
      await portfolioRepo.setCover(remaining[0].id, memberId);
    }
  }

  return portfolioRepo.list(memberId);
};

// Full replacement of the ordering (not a delta) - simplest contract for a
// drag-and-drop reorder UI. Must be an exact permutation of the current set.
export const reorderPortfolio = async (studioId, memberId, orderedImageIds) => {
  await assertMember(studioId, memberId);
  const existing = await portfolioRepo.list(memberId);
  const orderedIds = new Set(orderedImageIds);

  if (
    orderedImageIds.length !== existing.length ||
    orderedIds.size !== orderedImageIds.length ||
    !existing.every((img) => orderedIds.has(img.id))
  ) {
    throw new ServiceError(400, "orderedImageIds must match this professional's current portfolio images exactly");
  }

  await portfolioRepo.runInTransaction(async (trx) => {
    for (const [index, imageId] of orderedImageIds.entries()) {
      await portfolioRepo.updateSortOrder(imageId, memberId, index, trx);
    }
  });

  return portfolioRepo.list(memberId);
};

export const setCoverImage = async (studioId, memberId, imageId) => {
  await assertMember(studioId, memberId);
  const image = await portfolioRepo.findById(imageId, memberId);
  if (!image) throw new ServiceError(404, "Portfolio image not found");

  await portfolioRepo.runInTransaction(async (trx) => {
    await portfolioRepo.unsetCover(memberId, trx);
    await portfolioRepo.setCover(imageId, memberId, trx);
  });

  return portfolioRepo.list(memberId);
};

export const updateCaption = async (studioId, memberId, imageId, caption) => {
  await assertMember(studioId, memberId);
  const image = await portfolioRepo.findById(imageId, memberId);
  if (!image) throw new ServiceError(404, "Portfolio image not found");

  await portfolioRepo.updateCaption(imageId, memberId, caption || null);
  return portfolioRepo.list(memberId);
};
