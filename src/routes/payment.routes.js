import express from "express";
import { createPaymentOrder, verifyPayment, razorpayWebhook } from "../controllers/payment.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/create-order", apiLimiter, authenticate, createPaymentOrder);
router.post("/verify", apiLimiter, authenticate, verifyPayment);

// Server-to-server callback from Razorpay - authenticated via HMAC signature, not a JWT.
router.post("/webhook", razorpayWebhook);

export default router;
