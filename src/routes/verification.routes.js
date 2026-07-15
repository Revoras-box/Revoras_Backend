import express from "express";
import {
  sendVerificationCode,
  verifyCode,
} from "../controllers/verification.controller.js";
import { authLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/send-verification", authLimiter, sendVerificationCode);
router.post("/verify-code", authLimiter, verifyCode);

export default router;
