import * as businessMemberRepo from "../repositories/businessMember.repository.js";

/**
 * Resolves "is req.user an active member of :studioId" - authorization, not
 * authentication. Must run after authenticate.middleware.js (needs req.user
 * already set). Attaches req.businessMember, including the role KEY and
 * role_id (needed by requirePermission.middleware.js next in the chain).
 *
 * This replaces Phase 2.1's authenticateBusinessMember placeholder, which
 * combined "verify the JWT" and "check membership" into one call and did no
 * permission-key checking at all - every active member (owner or staff) was
 * treated as authorized for everything. That placeholder is retired as of
 * Phase 2.3 (report.md Phase 2 plan); real per-endpoint authorization is
 * requirePermission.middleware.js, composed after this one.
 */
export const requireBusinessMember = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Access token required" });

    const studioId = req.params.studioId || req.body.studioId;
    if (!studioId) return res.status(400).json({ error: "studioId is required" });

    const membership = await businessMemberRepo.findActiveMembership({ userId: req.user.id, studioId });
    if (!membership) {
      return res.status(403).json({ error: "Not a member of this business" });
    }

    req.businessMember = membership;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Phase 1.3c - resolves the caller's OWN membership for self-service (/api/me/*).
 * The professional is identified by the authenticated user + `studioId` (query,
 * uniform across JSON and multipart); we look up THEIR membership and set
 * req.params.studioId/memberId from it. A caller can never target another
 * member - no member id is read from the request. 403 if they aren't a member.
 */
export const resolveOwnMembership = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Access token required" });

    const studioId = req.query.studioId || req.body?.studioId;
    if (!studioId) return res.status(400).json({ error: "studioId is required" });

    const membership = await businessMemberRepo.findActiveMembership({ userId: req.user.id, studioId });
    if (!membership) {
      return res.status(403).json({ error: "Not a member of this business" });
    }

    req.params.studioId = studioId;
    req.params.memberId = membership.id;
    req.businessMember = membership;
    next();
  } catch (error) {
    next(error);
  }
};
