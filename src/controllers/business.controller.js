import * as businessService from "../services/business.service.js";
import { createBusinessSchema, updateBusinessSchema } from "../validators/business.validator.js";

// POST /api/business
export const createBusiness = async (req, res) => {
  const input = createBusinessSchema.parse(req.body);
  const business = await businessService.createBusiness(req.user.id, input);
  res.status(201).json({ message: "Business created successfully", business });
};

// GET /api/business/mine
export const getMyBusinesses = async (req, res) => {
  const businesses = await businessService.listMyBusinesses(req.user.id);
  res.json({ businesses });
};

// GET /api/business/:studioId
export const getBusinessById = async (req, res) => {
  const business = await businessService.getBusiness(req.params.studioId);
  res.json({ business });
};

// PATCH /api/business/:studioId
export const updateBusiness = async (req, res) => {
  const input = updateBusinessSchema.parse(req.body);
  const business = await businessService.updateBusiness(req.params.studioId, input);
  res.json({ message: "Business updated successfully", business });
};

// DELETE /api/business/:studioId
export const deactivateBusiness = async (req, res) => {
  await businessService.deactivateBusiness(req.params.studioId);
  res.json({ message: "Business deactivated successfully" });
};

// POST /api/business/:studioId/logo
export const uploadBusinessLogo = async (req, res) => {
  const business = await businessService.uploadBusinessLogo(req.params.studioId, req.file);
  res.json({ message: "Logo uploaded successfully", business });
};
