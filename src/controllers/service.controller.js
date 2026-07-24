import * as serviceService from "../services/service.service.js";
import { createServiceSchema, updateServiceSchema, listServicesQuerySchema } from "../validators/service.validator.js";

// GET /api/business/:studioId/services
export const listServices = async (req, res) => {
  const query = listServicesQuerySchema.parse(req.query);
  const services = await serviceService.listServices(req.params.studioId, query);
  res.json({ services });
};

// GET /api/business/:studioId/services/:serviceId
export const getService = async (req, res) => {
  const service = await serviceService.getService(req.params.studioId, req.params.serviceId);
  res.json({ service });
};

// POST /api/business/:studioId/services
export const createService = async (req, res) => {
  const input = createServiceSchema.parse(req.body);
  const service = await serviceService.createService(req.params.studioId, input);
  res.status(201).json({ message: "Service created successfully", service });
};

// PATCH /api/business/:studioId/services/:serviceId
export const updateService = async (req, res) => {
  const input = updateServiceSchema.parse(req.body);
  const service = await serviceService.updateService(req.params.studioId, req.params.serviceId, input);
  res.json({ message: "Service updated successfully", service });
};

// POST /api/business/:studioId/services/image
// Uploads a service photo and returns its public URL; the caller then sends
// that url as `imageUrl` on the create/update service call.
export const uploadServiceImage = async (req, res) => {
  const url = await serviceService.uploadServiceImage(req.params.studioId, req.file);
  res.status(201).json({ url });
};

// DELETE /api/business/:studioId/services/:serviceId
export const deactivateService = async (req, res) => {
  const service = await serviceService.deactivateService(req.params.studioId, req.params.serviceId);
  res.json({ message: "Service deactivated successfully", service });
};
