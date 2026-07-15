import * as adminDashboardService from "../services/adminDashboard.service.js";

// GET /api/admin/dashboard
export const getDashboard = async (req, res) => {
  const dashboard = await adminDashboardService.getDashboard();
  res.json({ dashboard });
};
