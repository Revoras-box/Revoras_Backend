import crypto from "crypto";
import knex from "../../db/knex.js";
import * as bookingRepo from "../repositories/booking.repository.js";
import * as paymentRepo from "../repositories/payment.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as notificationService from "./notification.service.js";
import { razorpay, isRazorpayConfigured } from "../config/razorpay.js";
import { isMockPaymentMode, paymentMode } from "../config/payments.js";
import { ServiceError } from "../utils/ServiceError.js";
import { logger } from "../utils/logger.js";
import { timingSafeEqualString } from "../utils/secureCompare.js";

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
 * Move a paid booking pending -> confirmed AND record it on the timeline.
 *
 * confirmIfPending alone flipped the status but left no event, so a booking
 * confirmed by payment showed only "Booking created" in its history - the
 * customer-facing timeline silently skipped the moment it became confirmed.
 * Every payment path (mock, client verify, webhook) goes through here so they
 * can't drift apart.
 */
const confirmPaidBooking = async (trx, bookingId, { reason }) => {
  const rowsChanged = await bookingRepo.confirmIfPending(trx, bookingId);
  if (!rowsChanged) return false;
  await bookingRepo.insertStatusEvent(
    { bookingId, fromStatus: "pending", toStatus: "confirmed", actorType: "system", actorId: null, reason },
    trx
  );
  return true;
};

/**
 * What the checkout should render before it asks anyone to pay. Public and
 * secret-free: the mode decides whether the client opens Razorpay or the
 * instant-confirm path, and the client must be able to label the button
 * honestly ("Test payment") rather than promising a charge that won't happen.
 */
export const getPaymentConfig = () => ({
  mode: paymentMode(),
  razorpayConfigured: isRazorpayConfigured(),
});

/**
 * TEMPORARY payment stand-in - see config/payments.js for why it exists and
 * how it's gated. One click: the booking's payment row is written as paid and
 * the booking moves pending -> confirmed, through exactly the same repo calls
 * and notifications as a verified Razorpay payment, so everything downstream
 * (confirmation page, bookings list, the slot showing as booked, the business
 * board) behaves identically to the real thing.
 *
 * No signature to verify and no money moved, so the row is marked with a
 * `mock_` payment id and left auditable rather than pretending to be a gateway
 * payment.
 */
export const confirmMockPayment = async ({ bookingId, userId }) => {
  if (!isMockPaymentMode()) {
    throw new ServiceError(400, "Instant confirmation is disabled on this server. Please pay through the payment window.");
  }
  if (!bookingId) throw new ServiceError(400, "bookingId is required");

  const booking = await bookingRepo.findByIdForUser(bookingId, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");

  if (booking.payment_id) {
    const existing = await paymentRepo.findById(booking.payment_id);
    if (existing?.status === "paid") {
      return { paid: true, alreadyPaid: true, bookingId: booking.id, mode: "mock" };
    }
  }

  const reference = `mock_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  const updated = await knex.transaction(async (trx) => {
    // Reuse the pending row when one exists (a customer who abandoned the real
    // gateway and came back), so a booking never accumulates payment rows.
    let payment = booking.payment_id ? await paymentRepo.findById(booking.payment_id) : null;
    if (!payment) {
      payment = await paymentRepo.create(
        {
          payable_type: "booking",
          payable_id: booking.id,
          user_id: userId,
          amount: booking.total_amount,
          status: "pending",
          razorpay_order_id: `${reference}_order`,
        },
        trx
      );
      await bookingRepo.setPaymentId(trx, booking.id, payment.id);
    }

    const result = await paymentRepo.markPaid(payment.id, { razorpayPaymentId: reference }, trx);
    if (result) await confirmPaidBooking(trx, booking.id, { reason: "Confirmed by test payment" });
    return result;
  });

  if (updated) await notifyPaymentSuccess(booking.id);

  logger.info(`Mock payment confirmed for booking ${booking.id} (${reference}) - no money moved`);

  return { paid: true, alreadyPaid: false, bookingId: booking.id, mode: "mock" };
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
  return timingSafeEqualString(expected, signature);
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
    if (result) await confirmPaidBooking(trx, bookingId, { reason: "Confirmed by payment" });
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
        await confirmPaidBooking(trx, paymentRow.payable_id, { reason: "Confirmed by payment" });
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
