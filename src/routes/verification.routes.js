import express from "express";
import {
  sendVerificationCode,
  verifyCode,
} from "../controllers/verification.controller.js";
import { authLimiter, authFloodLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/send-verification", authFloodLimiter, authLimiter, sendVerificationCode);
router.post("/verify-code", authFloodLimiter, authLimiter, verifyCode);

export default router;
