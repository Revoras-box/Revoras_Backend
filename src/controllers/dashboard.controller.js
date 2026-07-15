import * as dashboardService from "../services/dashboard.service.js";

// GET /api/business/:studioId/dashboard
export const getDashboard = async (req, res) => {
  const dashboard = await dashboardService.getDashboard(req.params.studioId);
  res.json({ dashboard });
};
