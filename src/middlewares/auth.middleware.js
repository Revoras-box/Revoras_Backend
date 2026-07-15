import jwt from "jsonwebtoken";
import * as adminRepo from "../repositories/admin.repository.js";

/**
 * Admin-only now (Phase 2.3, report.md Phase 2 plan) - renamed from
 * authenticateToken, which used to branch on decoded.role across four
 * different identities (user/studio_owner/barber/admin). Customer and
 * business-person auth moved to authenticate.middleware.js (a single
 * `users` table, minimal `{id, tv}` token, no role baked in); admins stay a
 * third, deliberately separate table/login/JWT shape (`{id, role}`) for
 * security blast-radius reasons - unaffected by this phase's changes.
 *
 * Moved off the raw `pool.query` pg client onto Knex as of Phase 2.5
 * (report.md Phase 2 plan - "remove remaining pool.query() usage
 * completely"), the last consumer of `config/db.js`, now deleted.
 */
export const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await adminRepo.findProfileById(decoded.id);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    if (user.is_active === false) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    req.user = { ...decoded, ...user };
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({ error: "Invalid token" });
    }
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Authentication failed" });
  }
};

/**
 * Require admin role
 */
export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== "admin" && req.user?.role !== "super_admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
};

/**
 * Optional authentication - doesn't fail if no token. Used by public browsing
 * routes (discovery.routes.js, review.routes.js's public GET endpoints) that
 * don't require auth but could use req.user for future personalization; left
 * as-is since it just decodes the token without a DB round trip and works
 * regardless of which token shape (old or new) is presented.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    }
    next();
  } catch {
    next();
  }
};
