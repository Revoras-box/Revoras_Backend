import express from "express";
import { forgotPassword, resetPassword } from "../controllers/password.controller.js";
import { authLimiter, authFloodLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/forgot-password", authFloodLimiter, authLimiter, forgotPassword);
router.post("/reset-password", authFloodLimiter, authLimiter, resetPassword);

export default router;
