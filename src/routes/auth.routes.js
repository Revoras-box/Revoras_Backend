import express from "express";
import { businessRegister, hostRegister, businessLogin, me, changePassword } from "../controllers/auth.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { authLimiter, apiLimiter } from "../middlewares/rateLimit.middleware.js";

/**
 * Phase 2.3 (report.md Phase 2 plan). Customer register/login stay at their
 * existing /api/users/signup|login paths (user.routes.js) - zero frontend
 * change needed there. Business register/login are genuinely new: they
 * replace the old dual-endpoint studio.auth.controller.js (owner) +
 * barber.controller.js (staff) split with the one endpoint each the brief
 * requires ("do not maintain separate Owner Login and Barber Login
 * endpoints") - role/permissions are resolved from business_members after
 * authenticating, not from which URL was called.
 */
const router = express.Router();

router.post("/business/register", authLimiter, businessRegister);
router.post("/host/register", authLimiter, hostRegister); // Phase 1.5a - host signup → DRAFT + wizard
router.post("/business/login", authLimiter, businessLogin);

router.get("/me", apiLimiter, authenticate, me);
router.post("/change-password", apiLimiter, authenticate, changePassword);

export default router;
