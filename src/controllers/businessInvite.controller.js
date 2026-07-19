import * as inviteService from "../services/businessInvite.service.js";
import { createInviteSchema, acceptInviteSchema } from "../validators/businessInvite.validator.js";

// GET /api/business/:studioId/invites
export const listInvites = async (req, res) => {
  const invites = await inviteService.listInvites(req.params.studioId);
  res.json({ invites });
};

// POST /api/business/:studioId/invites
export const createInvite = async (req, res) => {
  const input = createInviteSchema.parse(req.body);
  const invite = await inviteService.createInvite(req.params.studioId, input, req.user?.id);
  res.status(201).json({ message: "Invitation created", invite });
};

// POST /api/business/:studioId/invites/:inviteId/resend
export const resendInvite = async (req, res) => {
  const invite = await inviteService.resendInvite(req.params.studioId, req.params.inviteId);
  res.json({ message: "Invitation re-sent", invite });
};

// DELETE /api/business/:studioId/invites/:inviteId
export const revokeInvite = async (req, res) => {
  await inviteService.revokeInvite(req.params.studioId, req.params.inviteId);
  res.json({ message: "Invitation revoked" });
};

// GET /api/invites/:token - public; the invitee has no account yet.
export const previewInvite = async (req, res) => {
  const invite = await inviteService.previewInvite(req.params.token);
  res.json({ invite });
};

// POST /api/invites/:token/accept - public.
export const acceptInvite = async (req, res) => {
  const input = acceptInviteSchema.parse(req.body);
  const result = await inviteService.acceptInvite(req.params.token, input);
  res.status(201).json({ message: "Welcome to the team", ...result });
};
