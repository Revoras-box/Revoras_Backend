import jwt from "jsonwebtoken";
import * as userRepo from "../repositories/user.repository.js";

/**
 * Verifies a JWT for the unified person identity (report.md §2.0/§2.2) -
 * customers and business owners/staff are all the same `users` table, same
 * token shape, same middleware. This is authentication only: it doesn't know
 * or care about business membership - that's requireBusinessMember.js's job,
 * composed after this (report.md Phase 2.3 plan: "avoid combining
 * authentication and authorization into a single middleware").
 *
 * Token payload is the minimal `{ id, tv }` shape (report.md §4.1) - no role
 * or studioId baked in, since a person's roles/permissions can differ per
 * business and must always be resolved fresh from business_members, not
 * trusted from the token. `tv` (token_version) is checked against the DB on
 * every request - a password change/reset bumps it, which is how revocation
 * works here without a token blocklist.
 */
export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];
    if (!token) return res.status(401).json({ error: "Access token required" });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await userRepo.findById(decoded.id);
    if (!user) return res.status(401).json({ error: "User not found" });

    if (user.is_active === false) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    if (decoded.tv !== user.token_version) {
      return res.status(401).json({ error: "Token has been revoked, please log in again" });
    }

    const { password, token_version, failed_login_attempts, locked_until, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") return res.status(401).json({ error: "Token expired" });
    if (error.name === "JsonWebTokenError") return res.status(401).json({ error: "Invalid token" });
    next(error);
  }
};
