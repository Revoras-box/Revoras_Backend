import * as adminAnalyticsService from "../services/adminAnalytics.service.js";
import { adminAnalyticsQuerySchema } from "../validators/adminAnalytics.validator.js";

// GET /api/admin/analytics
export const getAnalytics = async (req, res) => {
  const query = adminAnalyticsQuerySchema.parse(req.query);
  const analytics = await adminAnalyticsService.getAnalytics(query);
  res.json({ analytics });
};
