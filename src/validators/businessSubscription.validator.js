import { z } from "zod";

// Phase 1.5d - subscription payment verification (client-confirmation path).
// Mirrors payment.validator.js's verifyPaymentSchema, minus bookingId (the
// business is already scoped by the route param).
export const verifySubscriptionSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
