import jwt from "jsonwebtoken";
import pool from "../config/db.js";

/**
 * Verify JWT token and attach user to request
 */
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Access token required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Verify user still exists and is active based on role
    let user;
    if (decoded.role === "user") {
      const result = await pool.query(
        "SELECT id, name, email, is_active FROM users WHERE id = $1",
        [decoded.id]
      );
      user = result.rows[0];
    } else if (decoded.role === "studio_owner") {
      const result = await pool.query(
        "SELECT id, name, email, studio_id, is_active FROM studio_owners WHERE id = $1",
        [decoded.id]
      );
      user = result.rows[0];
      if (user) {
        user.studioId = user.studio_id; // Add studioId for convenience
      }
    } else if (decoded.role === "barber") {
      const result = await pool.query(
        "SELECT id, name, email, studio_id, is_active FROM barbers WHERE id = $1",
        [decoded.id]
      );
      user = result.rows[0];
      if (user) {
        user.studioId = user.studio_id; // Add studioId for convenience
      }
    } else if (decoded.role === "admin" || decoded.role === "super_admin") {
      const result = await pool.query(
        "SELECT id, name, email, role, is_active FROM admins WHERE id = $1",
        [decoded.id]
      );
      user = result.rows[0];
    }

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
 * Require user role
 */
export const requireUser = (req, res, next) => {
  if (req.user?.role !== "user") {
    return res.status(403).json({ error: "User access required" });
  }
  next();
};

/**
 * Require studio owner role
 */
export const requireStudioOwner = (req, res, next) => {
  if (req.user?.role !== "studio_owner") {
    return res.status(403).json({ error: "Studio owner access required" });
  }
  next();
};

/**
 * Require barber role
 */
export const requireBarber = (req, res, next) => {
  if (req.user?.role !== "barber" && req.user?.role !== "studio_owner") {
    return res.status(403).json({ error: "Barber or studio owner access required" });
  }
  next();
};

/**
 * Require studio access (either owner or barber of the studio)
 */
export const requireStudioAccess = (req, res, next) => {
  if (req.user?.role !== "studio_owner" && req.user?.role !== "barber") {
    return res.status(403).json({ error: "Studio access required" });
  }
  next();
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
 * Optional authentication - doesn't fail if no token
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
