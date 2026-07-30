import jwt from "jsonwebtoken";
import * as adminRepo from "../repositories/admin.repository.js";
import * as userRepo from "../repositories/user.repository.js";
import { JWT_VERIFY_OPTIONS } from "../config/jwt.js";

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

    const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTIONS);

    // Customer/business tokens and admin tokens are signed with the same key
    // but describe different identity tables - `{id, tv}` vs `{id, role}`.
    // Today a customer token fails anyway (its id won't be found in `admins`),
    // but that is an accident of UUIDs not colliding, not a check. Require the
    // admin token shape explicitly so the separation is enforced rather than
    // merely likely.
    if (!decoded.role || decoded.tv !== undefined) {
      return res.status(401).json({ error: "Invalid token" });
    }

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
 * work fine anonymously but personalize when a token is present.
 *
 * It used to set `req.user` to the decoded JWT payload directly, with no
 * database round trip. That skipped both revocation checks the authenticated
 * path performs: a token whose `token_version` had been superseded by a
 * password reset still worked here, as did one belonging to a deactivated
 * account. Since the whole point of the `tv` claim is that a password reset
 * revokes outstanding sessions, a route that ignores it is a hole in that
 * guarantee - a small one while these routes stay read-only, but the kind that
 * stops being small the first time one of them starts writing.
 *
 * It also meant `req.user` here was a different shape from `req.user`
 * everywhere else (a bare `{id, tv}` rather than a user row), which is how a
 * handler ends up trusting a field that was never checked. Now it resolves the
 * same way `authenticate` does, and simply continues anonymously if anything
 * fails to check out.
 */
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET, JWT_VERIFY_OPTIONS);

    // Admin tokens carry `{id, role}` and index the separate `admins` table -
    // resolving one against `users` would be meaningless. Browse anonymously.
    if (!decoded.id || decoded.tv === undefined) return next();

    const user = await userRepo.findById(decoded.id);
    if (!user || user.is_active === false || decoded.tv !== user.token_version) return next();

    const { password, token_version, failed_login_attempts, locked_until, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch {
    next();
  }
};
