import * as analyticsService from "../services/analytics.service.js";
import { analyticsQuerySchema } from "../validators/analytics.validator.js";

// GET /api/business/:studioId/analytics
export const getAnalytics = async (req, res) => {
  const query = analyticsQuerySchema.parse(req.query);
  const analytics = await analyticsService.getAnalytics(req.params.studioId, query);
  res.json({ analytics });
};
