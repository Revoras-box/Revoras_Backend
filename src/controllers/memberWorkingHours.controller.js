import * as memberWorkingHoursService from "../services/memberWorkingHours.service.js";
import * as availabilityService from "../services/availability.service.js";
import { replaceMemberWorkingHoursSchema } from "../validators/memberWorkingHours.validator.js";
import { teamAvailabilityQuerySchema } from "../validators/booking.validator.js";

// GET /api/business/:studioId/members/:memberId/working-hours
export const getMemberWorkingHours = async (req, res) => {
  const schedule = await memberWorkingHoursService.getForMember(req.params.studioId, req.params.memberId);
  res.json(schedule);
};

// PUT /api/business/:studioId/members/:memberId/working-hours
export const replaceMemberWorkingHours = async (req, res) => {
  const body = replaceMemberWorkingHoursSchema.parse(req.body);
  const schedule = await memberWorkingHoursService.replaceForMember(
    req.params.studioId,
    req.params.memberId,
    body
  );
  res.json({ message: "Schedule updated successfully", ...schedule });
};

// GET /api/business/:studioId/availability - the whole team's free slots on a
// date, so the dashboard can answer "who can take a walk-in at 3pm?".
export const getTeamAvailability = async (req, res) => {
  const query = teamAvailabilityQuerySchema.parse(req.query);
  const result = await availabilityService.getTeamAvailability({
    studioId: req.params.studioId,
    ...query,
  });
  res.json(result);
};
