import * as geocodingService from "../services/geocoding.service.js";
import { forwardGeocodeQuerySchema, reverseGeocodeQuerySchema } from "../validators/geocoding.validator.js";

// GET /api/geocoding/search?q=...
export const forwardGeocode = async (req, res) => {
  const query = forwardGeocodeQuerySchema.parse(req.query);
  const result = await geocodingService.forwardGeocode(query);
  res.json(result);
};

// GET /api/geocoding/reverse?lat=...&lng=...
export const reverseGeocode = async (req, res) => {
  const query = reverseGeocodeQuerySchema.parse(req.query);
  const result = await geocodingService.reverseGeocode(query);
  res.json(result);
};
