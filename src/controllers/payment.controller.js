import crypto from "crypto";
import * as paymentService from "../services/payment.service.js";
import { createOrderSchema, verifyPaymentSchema } from "../validators/payment.validator.js";

// POST /api/payments/create-order
export const createPaymentOrder = async (req, res) => {
  const { bookingId } = createOrderSchema.parse(req.body);
  const order = await paymentService.createOrderForBooking({ bookingId, userId: req.user.id });
  res.json(order);
};

// POST /api/payments/verify
export const verifyPayment = async (req, res) => {
  const input = verifyPaymentSchema.parse(req.body);
  const result = await paymentService.verifyClientPayment({
    bookingId: input.bookingId,
    userId: req.user.id,
    razorpayOrderId: input.razorpay_order_id,
    razorpayPaymentId: input.razorpay_payment_id,
    razorpaySignature: input.razorpay_signature,
  });
  res.json({
    message: result.alreadyVerified ? "Payment already verified" : "Payment verified successfully",
    verified: true,
  });
};

/**
 * Server-to-server webhook - authenticated via HMAC signature (raw body
 * captured by server.js's express.json() verify hook), not a JWT.
 * POST /api/payments/webhook
 */
export const razorpayWebhook = async (req, res) => {
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn("Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set - ignoring");
    return res.status(503).end();
  }

  const signature = req.headers["x-razorpay-signature"];
  const expectedSignature = crypto.createHmac("sha256", webhookSecret).update(req.rawBody || "").digest("hex");

  if (!signature || signature !== expectedSignature) {
    return res.status(400).json({ error: "Invalid webhook signature" });
  }

  try {
    const { event, payload } = req.body;
    await paymentService.applyWebhookEvent({ event, payment: payload?.payment?.entity });
  } catch (error) {
    console.error("Razorpay webhook error:", error);
    // Still 200 so Razorpay doesn't retry-storm a request that failed for a bug on our side.
  }

  res.status(200).json({ received: true });
};
