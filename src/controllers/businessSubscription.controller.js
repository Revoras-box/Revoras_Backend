import * as subscriptionService from "../services/businessSubscription.service.js";
import { verifySubscriptionSchema } from "../validators/businessSubscription.validator.js";

// GET /api/business/:studioId/subscription
export const getSubscription = async (req, res) => {
  const state = await subscriptionService.getState(req.params.studioId);
  res.json(state);
};

// POST /api/business/:studioId/subscription/order
export const createSubscriptionOrder = async (req, res) => {
  const order = await subscriptionService.createOrder({ studioId: req.params.studioId, userId: req.user.id });
  res.json(order);
};

// POST /api/business/:studioId/subscription/activate-free
// TEMPORARY: finish onboarding without a payment while no gateway is live.
export const activateSubscriptionFree = async (req, res) => {
  const result = await subscriptionService.activateWithoutPayment({ studioId: req.params.studioId, userId: req.user.id });
  res.json({ message: "Subscription activated", ...result });
};

// POST /api/business/:studioId/subscription/verify
export const verifySubscriptionPayment = async (req, res) => {
  const input = verifySubscriptionSchema.parse(req.body);
  const result = await subscriptionService.verifyClientPayment({
    studioId: req.params.studioId,
    userId: req.user.id,
    razorpayOrderId: input.razorpay_order_id,
    razorpayPaymentId: input.razorpay_payment_id,
    razorpaySignature: input.razorpay_signature,
  });
  res.json({
    message: result.alreadyVerified ? "Payment already verified" : "Payment verified successfully",
    verified: true,
    businessStatus: result.businessStatus,
  });
};
