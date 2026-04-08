import express from "express";
import {
  adminLogin,
  getAdminProfile,
  getDashboardStats,
  getAdminStudios,
  getAdminStudioById,
  updateAdminStudio,
  approveStudio,
  rejectStudio,
  suspendStudio,
  geocodeStudio,
  getAdminUsers,
  createAdmin,
  getAdmins
} from "../controller/admin.controller.js";
import { authenticateToken, requireAdmin } from "../middlewares/auth.middleware.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

// Apply rate limiting to all admin routes
router.use(apiLimiter);

// ==========================================
// Public Routes (no auth)
// ==========================================

// Admin login
router.post("/login", adminLogin);

// ==========================================
// Protected Routes (require admin auth)
// ==========================================

// Apply auth middleware to all routes below
router.use(authenticateToken);
router.use(requireAdmin);

// Profile
router.get("/me", getAdminProfile);

// Dashboard
router.get("/dashboard", getDashboardStats);

// ==========================================
// Studio Management
// ==========================================

// Get all studios with filtering
router.get("/studios", getAdminStudios);

// Get single studio
router.get("/studios/:id", getAdminStudioById);

// Update studio
router.put("/studios/:id", updateAdminStudio);

// Approve studio
router.post("/studios/:id/approve", approveStudio);

// Reject studio
router.post("/studios/:id/reject", rejectStudio);

// Suspend studio
router.post("/studios/:id/suspend", suspendStudio);

// Geocode studio address
router.post("/studios/:id/geocode", geocodeStudio);

// ==========================================
// User Management
// ==========================================

router.get("/users", getAdminUsers);

// ==========================================
// Admin Management (Super Admin Only)
// ==========================================

router.get("/admins", getAdmins);
router.post("/admins", createAdmin);

export default router;
