import express from "express";
import {
  sendVerificationCode,
  verifyCode,
} from "../controller/verification.controller.js";

const router = express.Router();

router.post("/send-verification", sendVerificationCode);
router.post("/verify-code", verifyCode);

export default router;
