import * as businessMemberService from "../services/businessMember.service.js";
import { addMemberSchema, updateMemberSchema } from "../validators/businessMember.validator.js";

// GET /api/business/:studioId/members
export const listMembers = async (req, res) => {
  const members = await businessMemberService.listMembers(req.params.studioId);
  res.json({ members });
};

// GET /api/business/:studioId/members/:memberId
export const getMember = async (req, res) => {
  const member = await businessMemberService.getMember(req.params.studioId, req.params.memberId);
  res.json({ member });
};

// POST /api/business/:studioId/members
export const addMember = async (req, res) => {
  const input = addMemberSchema.parse(req.body);
  const member = await businessMemberService.addMember(req.params.studioId, input);
  res.status(201).json({ message: "Team member added successfully", member });
};

// PATCH /api/business/:studioId/members/:memberId
export const updateMember = async (req, res) => {
  const input = updateMemberSchema.parse(req.body);
  const member = await businessMemberService.updateMember(req.params.studioId, req.params.memberId, input);
  res.json({ message: "Team member updated successfully", member });
};

// DELETE /api/business/:studioId/members/:memberId
export const removeMember = async (req, res) => {
  await businessMemberService.removeMember(req.params.studioId, req.params.memberId);
  res.json({ message: "Team member removed successfully" });
};
