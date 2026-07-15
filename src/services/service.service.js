import * as serviceRepo from "../repositories/service.repository.js";
import * as categoryRepo from "../repositories/category.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

const assertServiceCategory = async (categoryId) => {
  const category = await categoryRepo.findById(categoryId);
  if (!category || category.type !== "service") {
    throw new ServiceError(400, "categoryId must reference a service-type category");
  }
};

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
  await assertServiceCategory(input.categoryId);

  return serviceRepo.create({
    studio_id: studioId,
    name: input.name,
    description: input.description || null,
    category_id: input.categoryId,
    price: input.price,
    duration: input.duration,
    image_url: input.imageUrl || null,
    is_active: input.isActive !== false,
  });
};

export const updateService = async (studioId, serviceId, input) => {
  const existing = await serviceRepo.findByIdForStudio(serviceId, studioId);
  if (!existing) throw new ServiceError(404, "Service not found");

  if (input.categoryId !== undefined) await assertServiceCategory(input.categoryId);

  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.price !== undefined) patch.price = input.price;
  if (input.duration !== undefined) patch.duration = input.duration;
  if (input.imageUrl !== undefined) patch.image_url = input.imageUrl;
  if (input.isActive !== undefined) patch.is_active = input.isActive;

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(400, "No fields to update");
  }

  return serviceRepo.update(serviceId, studioId, patch);
};

// "Delete" deactivates rather than removing the row - services with booking
// history can't be hard-deleted anyway (booking_services.service_id is
// ON DELETE RESTRICT), and keeping the row is what preserves that history.
export const deactivateService = async (studioId, serviceId) => {
  const existing = await serviceRepo.findByIdForStudio(serviceId, studioId);
  if (!existing) throw new ServiceError(404, "Service not found");

  return serviceRepo.setActive(serviceId, studioId, false);
};
