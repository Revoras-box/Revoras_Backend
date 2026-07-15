import * as permissionService from "../services/permission.service.js";

/**
 * DB-driven authorization (report.md §3.2, Phase 2.3 plan) - checks the
 * caller's effective permission set (role_permissions, with per-member
 * business_member_permission_overrides layered on top), never a hardcoded
 * role string. Must run after requireBusinessMember.middleware.js (needs
 * req.businessMember already set).
 *
 * Usage: router.patch("/", authenticate, requireBusinessMember, requirePermission("settings.manage"), updateBusiness)
 */
export const requirePermission = (key) => async (req, res, next) => {
  try {
    if (!req.businessMember) return res.status(401).json({ error: "Access token required" });

    const allowed = await permissionService.hasPermission(req.businessMember.id, req.businessMember.role_id, key);
    if (!allowed) {
      return res.status(403).json({ error: `Missing permission: ${key}` });
    }

    next();
  } catch (error) {
    next(error);
  }
};
