import * as timeOffService from "../services/timeOff.service.js";
import { createTimeOffSchema, listTimeOffQuerySchema } from "../validators/timeOff.validator.js";

// GET /api/business/:studioId/time-off
// Staff only ever see their own blocked time; owners can see/filter by anyone's.
export const listTimeOff = async (req, res) => {
  const query = listTimeOffQuerySchema.parse(req.query);
  const scopedQuery =
    req.businessMember.role === "staff" ? { ...query, businessMemberId: req.businessMember.id } : query;
  const timeOff = await timeOffService.list(req.params.studioId, scopedQuery);
  res.json({ timeOff });
};

// POST /api/business/:studioId/time-off
// Staff can only block their own time; owners can pick any professional on the business.
export const createTimeOff = async (req, res) => {
  const input = createTimeOffSchema.parse(req.body);
  const businessMemberId = req.businessMember.role === "staff" ? req.businessMember.id : input.businessMemberId;
  const timeOff = await timeOffService.create(req.params.studioId, { ...input, businessMemberId });
  res.status(201).json({ timeOff });
};

// DELETE /api/business/:studioId/time-off/:id
// Staff can only remove their own blocked time; owners can remove anyone's on
// the business (same scoping the old requireStudioAccess-gated route had).
export const deleteTimeOff = async (req, res) => {
  await timeOffService.remove(req.params.studioId, req.params.id, {
    businessMemberId: req.businessMember.role === "staff" ? req.businessMember.id : undefined,
  });
  res.json({ message: "Blocked time removed" });
};
