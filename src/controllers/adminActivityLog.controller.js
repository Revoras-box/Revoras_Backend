import * as adminActivityLogService from "../services/adminActivityLog.service.js";
import { listActivityQuerySchema } from "../validators/adminActivityLog.validator.js";

// GET /api/admin/activity-log
export const listActivity = async (req, res) => {
  const query = listActivityQuerySchema.parse(req.query);
  const result = await adminActivityLogService.list(query);
  res.json(result);
};
