import express from "express";
import {
  createPaymentOrder,
  verifyPayment,
  razorpayWebhook,
  getPaymentConfig,
  confirmMockPayment,
} from "../controllers/payment.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

// Secret-free (mode only) and needed before the customer signs anything, so
// it's readable without a token.
router.get("/config", apiLimiter, getPaymentConfig);

router.post("/create-order", apiLimiter, authenticate, createPaymentOrder);
router.post("/verify", apiLimiter, authenticate, verifyPayment);

// TEMPORARY: confirms a booking without a gateway. Refuses unless the server
// is in mock mode (config/payments.js).
router.post("/mock-confirm", apiLimiter, authenticate, confirmMockPayment);

// Server-to-server callback from Razorpay - authenticated via HMAC signature, not a JWT.
router.post("/webhook", razorpayWebhook);

export default router;
