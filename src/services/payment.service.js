import crypto from "crypto";
import knex from "../../db/knex.js";
import * as bookingRepo from "../repositories/booking.repository.js";
import * as paymentRepo from "../repositories/payment.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as notificationService from "./notification.service.js";
import { razorpay, isRazorpayConfigured } from "../config/razorpay.js";
import { ServiceError } from "../utils/ServiceError.js";
import { logger } from "../utils/logger.js";

/**
 * Fires "payment received" + "booking confirmed" notifications - called only
 * when markPaid actually transitioned the row (it's a no-op update once
 * already paid), so whichever path - client-side verify or the webhook -
 * gets there first is the one that notifies; the other is a safe no-op.
 * Deliberately runs after the DB transaction commits, not inside it -
 * notification delivery failing shouldn't roll back a real payment. Errors
 * are caught and logged, not thrown: a webhook handler that throws here
 * would return non-2xx to Razorpay for a payment that was, in fact,
 * successfully recorded, triggering pointless retries.
 */
const notifyPaymentSuccess = async (bookingId) => {
  try {
    const booking = await bookingRepo.findById(bookingId);
    if (!booking) return;

    const business = await businessRepo.findById(booking.studio_id);
    const notificationData = {
      businessName: business?.name || "your business",
      date: booking.booking_date,
      time: booking.start_time,
      amount: booking.total_amount,
    };

    await Promise.all([
      notificationService.notifyPaymentReceived(booking.user_id, notificationData),
      notificationService.notifyBookingConfirmed(booking.user_id, notificationData),
    ]);
  } catch (err) {
    logger.error("Payment-success notification delivery failed", err);
  }
};

/**
 * `payments` centralizes what used to be spread across bookings.razorpay_* -
 * report.md §3.2. A booking's payment state is now: no payment yet
 * (bookings.payment_id IS NULL), pending (payment_id set, payments.status
 * = 'pending'), or paid (payments.status = 'paid').
 */
export const createOrderForBooking = async ({ bookingId, userId }) => {
  if (!isRazorpayConfigured()) {
    throw new ServiceError(503, "Payments are not configured on this server yet");
  }
  if (!bookingId) throw new ServiceError(400, "bookingId is required");

  const booking = await bookingRepo.findByIdForUser(bookingId, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");

  if (booking.payment_id) {
    const existingPayment = await paymentRepo.findById(booking.payment_id);
    if (existingPayment?.status === "paid") {
      throw new ServiceError(400, "Booking is already paid");
    }
  }

  const amountInPaise = Math.round(Number(booking.total_amount) * 100);
  if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
    throw new ServiceError(400, "Booking has no payable amount");
  }

  const order = await razorpay.orders.create({
    amount: amountInPaise,
    currency: "INR",
    receipt: booking.confirmation_code || `booking_${booking.id}`,
    notes: { bookingId: String(booking.id) },
  });

  const payment = await knex.transaction(async (trx) => {
    const created = await paymentRepo.create(
      {
        payable_type: "booking",
        payable_id: booking.id,
        user_id: userId,
        amount: booking.total_amount,
        status: "pending",
        razorpay_order_id: order.id,
      },
      trx
    );
    await bookingRepo.setPaymentId(trx, booking.id, created.id);
    return created;
  });

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    bookingId: booking.id,
    paymentId: payment.id,
  };
};

const verifySignature = (orderId, paymentId, signature) => {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
};

/**
 * Client-side confirmation path - never the sole source of truth. The webhook
 * below is authoritative even if this never fires (closed tab, network drop).
 */
export const verifyClientPayment = async ({
  bookingId,
  userId,
  razorpayOrderId,
  razorpayPaymentId,
  razorpaySignature,
}) => {
  if (!isRazorpayConfigured()) {
    throw new ServiceError(503, "Payments are not configured on this server yet");
  }
  if (!bookingId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new ServiceError(400, "Missing payment verification fields");
  }

  const booking = await bookingRepo.findByIdForUser(bookingId, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");
  if (!booking.payment_id) throw new ServiceError(400, "No payment has been started for this booking");

  const payment = await paymentRepo.findById(booking.payment_id);
  if (payment.razorpay_order_id !== razorpayOrderId) {
    throw new ServiceError(400, "Order does not match this booking");
  }
  if (payment.status === "paid") {
    return { verified: true, alreadyVerified: true };
  }

  if (!verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    await paymentRepo.markFailed(payment.id);
    throw new ServiceError(400, "Payment verification failed");
  }

  const updated = await knex.transaction(async (trx) => {
    const result = await paymentRepo.markPaid(payment.id, { razorpayPaymentId }, trx);
    if (result) await bookingRepo.confirmIfPending(trx, bookingId);
    return result;
  });

  if (updated) await notifyPaymentSuccess(bookingId);

  return { verified: true, alreadyVerified: false };
};

/**
 * Razorpay server-to-server webhook - the actual source of truth. Signature
 * is checked by the controller (needs the raw request body); this only
 * handles the resulting event.
 *
 * `payments` is polymorphic (payable_type), but each domain owns its own
 * activation side effects rather than this file knowing all of them - the
 * booking path below is unchanged from before Phase 1.5d; a 'subscription'
 * row is dispatched to businessSubscription.service.js (deferred import to
 * avoid a static require cycle - that service imports businessLifecycle.service.js,
 * not this file, so there's no cycle here, but keeping the import pattern
 * consistent with the rest of the codebase's cross-domain dispatch).
 */
export const applyWebhookEvent = async ({ event, payment }) => {
  if (!payment?.order_id) return;

  const paymentRow = await paymentRepo.findByRazorpayOrderId(payment.order_id);
  if (!paymentRow) return;

  if (event === "payment.captured") {
    if (paymentRow.payable_type === "subscription") {
      const { activateSubscriptionFromWebhook } = await import("./businessSubscription.service.js");
      await activateSubscriptionFromWebhook(paymentRow, payment.id);
      return;
    }

    const updated = await knex.transaction(async (trx) => {
      const result = await paymentRepo.markPaid(paymentRow.id, { razorpayPaymentId: payment.id }, trx);
      if (result) {
        await bookingRepo.confirmIfPending(trx, paymentRow.payable_id);
      }
      return result;
    });

    if (updated && paymentRow.payable_type === "booking") {
      await notifyPaymentSuccess(paymentRow.payable_id);
    }
  } else if (event === "payment.failed") {
    await paymentRepo.markFailed(paymentRow.id);
  }
};
