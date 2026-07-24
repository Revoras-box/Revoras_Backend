import * as serviceRepo from "../repositories/service.repository.js";
import * as categoryRepo from "../repositories/category.repository.js";
import * as mediaService from "./media.service.js";
import { ServiceError } from "../utils/ServiceError.js";

const assertServiceCategory = async (categoryId) => {
  const category = await categoryRepo.findById(categoryId);
  if (!category || category.type !== "service") {
    throw new ServiceError(400, "categoryId must reference a service-type category");
  }
  return category;
};

// The typed label only makes sense on the catch-all "Other" category; for every
// real category we store null so the field never carries a stale custom name.
const resolveCustomCategory = (category, customCategory) =>
  category?.slug === "other" ? customCategory?.trim() || null : null;

export const listServices = (studioId, { activeOnly } = {}) => serviceRepo.listForStudio(studioId, { activeOnly });

export const getService = async (studioId, serviceId) => {
  const service = await serviceRepo.findByIdForStudio(serviceId, studioId);
  if (!service) throw new ServiceError(404, "Service not found");
  return service;
};

// Authorization (services.manage) is enforced by requirePermission at the
// route level, not here - report.md Phase 2.3 plan's "controllers/services
// hold no permission logic" rule.
export const createService = async (studioId, input) => {
  const category = await assertServiceCategory(input.categoryId);

  return serviceRepo.create({
    studio_id: studioId,
    name: input.name,
    description: input.description || null,
    category_id: input.categoryId,
    custom_category: resolveCustomCategory(category, input.customCategory),
    price: input.price,
    duration: input.duration,
    image_url: input.imageUrl || null,
    is_active: input.isActive !== false,
  });
};

export const updateService = async (studioId, serviceId, input) => {
  const existing = await serviceRepo.findByIdForStudio(serviceId, studioId);
  if (!existing) throw new ServiceError(404, "Service not found");

  let targetCategory = null;
  if (input.categoryId !== undefined) targetCategory = await assertServiceCategory(input.categoryId);

  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  // Keep custom_category consistent with whatever category the service ends up
  // in: recompute when the category changes, or when only the label is edited
  // (against the service's existing category slug).
  if (input.categoryId !== undefined) {
    patch.custom_category = resolveCustomCategory(targetCategory, input.customCategory);
  } else if (input.customCategory !== undefined) {
    patch.custom_category = resolveCustomCategory({ slug: existing.category_slug }, input.customCategory);
  }
  if (input.price !== undefined) patch.price = input.price;
  if (input.duration !== undefined) patch.duration = input.duration;
  if (input.imageUrl !== undefined) patch.image_url = input.imageUrl;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(400, "No fields to update");
  }

  return serviceRepo.update(serviceId, studioId, patch);
};

// A service's single showcase photo. Uploaded straight to R2 via MediaService
// (same path as the logo/gallery) and the returned URL is stored on the service
// row as image_url - by the create/update call, so this only returns the URL.
// Kept separate from create/update because the "Add service" form uploads the
// photo before the service row exists.
export const uploadServiceImage = async (studioId, file) => {
  if (!file) throw new ServiceError(400, "No file uploaded");

  const { url } = await mediaService.uploadMedia({
    buffer: file.buffer,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    folder: mediaService.MEDIA_FOLDERS.SERVICES,
    entityId: studioId,
    prefix: "service",
  });

  return url;
};

// "Delete" deactivates rather than removing the row - services with booking
// history can't be hard-deleted anyway (booking_services.service_id is
// ON DELETE RESTRICT), and keeping the row is what preserves that history.
export const deactivateService = async (studioId, serviceId) => {
  const existing = await serviceRepo.findByIdForStudio(serviceId, studioId);
  if (!existing) throw new ServiceError(404, "Service not found");

  return serviceRepo.setActive(serviceId, studioId, false);
};
