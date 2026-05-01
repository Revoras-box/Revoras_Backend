import express from "express";
import {
  signupStudio,
  loginStudio,
  getStudioOwnerProfile,
  addBarberToStudio,
  updateBarberInStudio,
  deleteBarberFromStudio,
  loginBarber
} from "../controller/studio.auth.controller.js";
import { authenticateToken, requireStudioOwner } from "../middlewares/auth.middleware.js";

const router = express.Router();

// ==========================================
// Public Routes (No Auth Required)
// ==========================================

// Studio owner signup
router.post("/auth/signup", signupStudio);

// Studio owner login
router.post("/auth/login", loginStudio);

// Barber login (for barbers added by studio)
router.post("/auth/barber-login", loginBarber);

// ==========================================
// Protected Routes (Studio Owner Required)
// ==========================================

// Get current owner profile
router.get("/auth/me", authenticateToken, requireStudioOwner, getStudioOwnerProfile);

// Add barber to studio
router.post("/auth/barbers", authenticateToken, requireStudioOwner, addBarberToStudio);
router.put("/auth/barbers/:barberId", authenticateToken, requireStudioOwner, updateBarberInStudio);
router.delete("/auth/barbers/:barberId", authenticateToken, requireStudioOwner, deleteBarberFromStudio);

export default router;
