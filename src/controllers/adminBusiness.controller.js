import * as adminBusinessService from "../services/adminBusiness.service.js";
import {
  listBusinessesQuerySchema,
  updateBusinessSchema,
  approveBusinessSchema,
  rejectBusinessSchema,
  suspendBusinessSchema,
  geocodeBusinessSchema,
  setFeaturedSchema,
} from "../validators/adminBusiness.validator.js";

// GET /api/admin/businesses
export const listBusinesses = async (req, res) => {
  const query = listBusinessesQuerySchema.parse(req.query);
  const result = await adminBusinessService.list(query);
  res.json(result);
};

// GET /api/admin/businesses/:id
export const getBusiness = async (req, res) => {
  const business = await adminBusinessService.getById(req.params.id);
  res.json({ business });
};

// PUT /api/admin/businesses/:id
export const updateBusiness = async (req, res) => {
  const input = updateBusinessSchema.parse(req.body);
  const business = await adminBusinessService.update(req.params.id, input, req.user.id, req.ip);
  res.json({ message: "Business updated successfully", business });
};

// POST /api/admin/businesses/:id/approve
export const approveBusiness = async (req, res) => {
  const input = approveBusinessSchema.parse(req.body);
  const business = await adminBusinessService.approve(req.params.id, req.user.id, input, req.ip);
  res.json({ message: "Business approved successfully", business });
};

// POST /api/admin/businesses/:id/reject
export const rejectBusiness = async (req, res) => {
  const input = rejectBusinessSchema.parse(req.body);
  const business = await adminBusinessService.reject(req.params.id, req.user.id, input, req.ip);
  res.json({ message: "Business rejected", business });
};

// POST /api/admin/businesses/:id/suspend
export const suspendBusiness = async (req, res) => {
  const input = suspendBusinessSchema.parse(req.body);
  const business = await adminBusinessService.suspend(req.params.id, req.user.id, input, req.ip);
  res.json({ message: "Business suspended", business });
};

// POST /api/admin/businesses/:id/geocode
export const geocodeBusiness = async (req, res) => {
  const input = geocodeBusinessSchema.parse(req.body);
  const location = await adminBusinessService.geocode(req.params.id, input, req.user.id, req.ip);
  res.json({ message: "Business geocoded successfully", location });
};

// PATCH /api/admin/businesses/:id/featured
export const setFeatured = async (req, res) => {
  const input = setFeaturedSchema.parse(req.body);
  const business = await adminBusinessService.setFeatured(req.params.id, input, req.user.id, req.ip);
  res.json({ message: input.isFeatured ? "Business featured" : "Business unfeatured", business });
};
