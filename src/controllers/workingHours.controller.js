import * as workingHoursService from "../services/workingHours.service.js";
import { replaceWorkingHoursSchema } from "../validators/workingHours.validator.js";

// GET /api/business/:studioId/working-hours
export const getWorkingHours = async (req, res) => {
  const workingHours = await workingHoursService.getForStudio(req.params.studioId);
  res.json({ workingHours });
};

// PUT /api/business/:studioId/working-hours
export const replaceWorkingHours = async (req, res) => {
  const { days } = replaceWorkingHoursSchema.parse(req.body);
  const workingHours = await workingHoursService.replaceForStudio(req.params.studioId, days);
  res.json({ message: "Working hours updated successfully", workingHours });
};
