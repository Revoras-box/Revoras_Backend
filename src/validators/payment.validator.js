import { z } from "zod";

const uuid = z.string().uuid();

export const createOrderSchema = z.object({
  bookingId: uuid,
});

export const verifyPaymentSchema = z.object({
  bookingId: uuid,
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
});
