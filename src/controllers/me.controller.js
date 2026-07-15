import * as businessMemberService from "../services/businessMember.service.js";
import { updateOwnProfileSchema } from "../validators/businessMember.validator.js";

// GET /api/me/profile?studioId=...
// resolveOwnMembership has already set req.params.studioId/memberId to the
// caller's OWN membership - no arbitrary member id is ever accepted here.
export const getMyProfile = async (req, res) => {
  const profile = await businessMemberService.getMember(req.params.studioId, req.params.memberId);
  res.json({ profile });
};

// PATCH /api/me/profile?studioId=...
// Only self-editable fields (bio, languages, education, awards, social links).
// Business-controlled fields (role, permissions, designation, experience,
// featured services, employment) are not in updateOwnProfileSchema, so a
// professional cannot elevate or change them here.
export const updateMyProfile = async (req, res) => {
  const input = updateOwnProfileSchema.parse(req.body);
  const profile = await businessMemberService.updateOwnProfile(req.params.studioId, req.params.memberId, input);
  res.json({ message: "Profile updated", profile });
};
