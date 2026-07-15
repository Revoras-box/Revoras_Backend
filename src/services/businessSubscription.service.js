import crypto from "crypto";
import knex from "../../db/knex.js";
import * as subRepo from "../repositories/businessSubscription.repository.js";
import * as paymentRepo from "../repositories/payment.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as lifecycle from "./businessLifecycle.service.js";
import * as notificationService from "./notification.service.js";
import { razorpay, isRazorpayConfigured } from "../config/razorpay.js";
import { ServiceError } from "../utils/ServiceError.js";
import { logger } from "../utils/logger.js";

/**
 * Phase 1.5d - the ₹99/month subscription (O4: "₹99 gates entry to review, not
 * listing" - docs/business-lifecycle-state-machine.md). Mirrors payment.service.js's
 * booking-payment pattern (Razorpay order -> client-verify or webhook, whichever
 * wins) against the same polymorphic `payments` table (payable_type:
 * 'subscription'), but owns its own signature check + activation side effects
 * rather than reusing payment.service.js's booking-specific ones.
 *
 * Only one plan exists today - no trial, no tiers (none of those are part of
 * the locked O1-O5 decisions, so none are invented here). Renewal is supported
 * mechanically (createOrder works again once ACTIVE, via canReceivePayments);
 * there is no scheduler in this codebase yet to auto-expire a lapsed period or
 * send renewal reminders (same gap already called out on
 * notification.service.js's notifyBookingReminder) - `isCurrentlyActive` below
 * checks the period end on every read instead, so a lapsed subscription is
 * correctly reported even without a cron flipping its status.
 */

export const PLAN = Object.freeze({
  key: "standard_monthly",
  label: "Revoras for Business",
  amount: 99,
  currency: "INR",
  periodDays: 30,
});

const serialize = (row) => ({
  id: row.id,
  plan: row.plan,
  amount: Number(row.amount),
  currency: row.currency,
  status: row.status,
  currentPeriodStart: row.current_period_start,
  currentPeriodEnd: row.current_period_end,
  createdAt: row.created_at,
});

const isCurrentlyActive = (row) =>
  !!row && row.status === "active" && !!row.current_period_end && new Date(row.current_period_end) > new Date();

// GET /api/business/:studioId/subscription
export const getState = async (studioId) => {
  const business = await businessRepo.findStatus(studioId);
  if (!business) throw new ServiceError(404, "Business not found");

  const history = await subRepo.listForBusiness(studioId);
  const current = history[0] ?? null;

  return {
    businessStatus: business.business_status,
    configured: isRazorpayConfigured(),
    plan: PLAN,
    active: isCurrentlyActive(current),
    current: current ? serialize(current) : null,
    history: history.map(serialize),
  };
};

// POST /api/business/:studioId/subscription/order
export const createOrder = async ({ studioId, userId }) => {
  if (!isRazorpayConfigured()) {
    throw new ServiceError(503, "Payments are not configured on this server yet");
  }

  const business = await businessRepo.findStatus(studioId);
  if (!business) throw new ServiceError(404, "Business not found");
  if (!lifecycle.canReceivePayments(business.business_status)) {
    throw new ServiceError(409, "This business cannot accept a subscription payment right now");
  }

  const amountInPaise = Math.round(PLAN.amount * 100);
  const order = await razorpay.orders.create({
    amount: amountInPaise,
    currency: PLAN.currency,
    receipt: `sub_${studioId}_${Date.now()}`,
    notes: { studioId, plan: PLAN.key },
  });

  const subscription = await knex.transaction(async (trx) => {
    const created = await subRepo.create(
      { business_id: studioId, plan: PLAN.key, amount: PLAN.amount, currency: PLAN.currency, status: "pending" },
      trx
    );
    await paymentRepo.create(
      {
        payable_type: "subscription",
        payable_id: created.id,
        user_id: userId,
        amount: PLAN.amount,
        currency: PLAN.currency,
        status: "pending",
        razorpay_order_id: order.id,
      },
      trx
    );
    return created;
  });

  return {
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId: process.env.RAZORPAY_KEY_ID,
    subscriptionId: subscription.id,
  };
};

const verifySignature = (orderId, paymentId, signature) => {
  const expected = crypto
    .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return expected === signature;
};

const notifySubscriptionActive = async (businessId, notifyUserId) => {
  if (!notifyUserId) return;
  try {
    const business = await businessRepo.findById(businessId);
    await notificationService.notifySubscriptionActivated(notifyUserId, {
      businessName: business?.name || "your business",
      amount: PLAN.amount,
    });
  } catch (err) {
    logger.error("Subscription-activated notification delivery failed", err);
  }
};

/**
 * Marks the payment paid + the subscription active, then (only if the business
 * was actually waiting on this payment) advances PAYMENT_PENDING ->
 * PENDING_REVIEW. Shared by both the client-verify and webhook paths -
 * `paymentRepo.markPaid`'s `andWhereNot status='paid'` makes this idempotent,
 * so whichever path wins the race runs the side effects exactly once (same
 * idempotency pattern as payment.service.js's notifyPaymentSuccess).
 */
const activateSubscription = async ({ paymentId, subscriptionId, businessId, razorpayPaymentId, notifyUserId }) => {
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + PLAN.periodDays * 24 * 60 * 60 * 1000);

  const updated = await knex.transaction(async (trx) => {
    const paidPayment = await paymentRepo.markPaid(paymentId, { razorpayPaymentId }, trx);
    if (!paidPayment) return null;
    await subRepo.markActive(subscriptionId, { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd }, trx);
    return paidPayment;
  });

  if (!updated) return null;

  const status = await lifecycle.getStatus(businessId);
  if (status === lifecycle.STATUS.PAYMENT_PENDING) {
    await lifecycle.transition(businessId, lifecycle.STATUS.PENDING_REVIEW);
  }

  await notifySubscriptionActive(businessId, notifyUserId);
  return updated;
};

// POST /api/business/:studioId/subscription/verify - client-side confirmation
// path, never the sole source of truth; the webhook below is authoritative
// even if this never fires (closed tab, network drop).
export const verifyClientPayment = async ({ studioId, userId, razorpayOrderId, razorpayPaymentId, razorpaySignature }) => {
  if (!isRazorpayConfigured()) {
    throw new ServiceError(503, "Payments are not configured on this server yet");
  }
  if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    throw new ServiceError(400, "Missing payment verification fields");
  }

  const payment = await paymentRepo.findByRazorpayOrderId(razorpayOrderId);
  if (!payment || payment.payable_type !== "subscription") {
    throw new ServiceError(404, "Subscription order not found");
  }

  const subscription = await subRepo.findById(payment.payable_id);
  if (!subscription || subscription.business_id !== studioId) {
    throw new ServiceError(400, "Order does not match this business");
  }
  if (payment.status === "paid") {
    return { verified: true, alreadyVerified: true, businessStatus: await lifecycle.getStatus(studioId) };
  }

  if (!verifySignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    await paymentRepo.markFailed(payment.id);
    throw new ServiceError(400, "Payment verification failed");
  }

  await activateSubscription({
    paymentId: payment.id,
    subscriptionId: subscription.id,
    businessId: studioId,
    razorpayPaymentId,
    notifyUserId: userId,
  });

  return { verified: true, alreadyVerified: false, businessStatus: await lifecycle.getStatus(studioId) };
};

/**
 * Razorpay server-to-server webhook path - called from payment.service.js's
 * applyWebhookEvent once it resolves a payments row with payable_type ===
 * 'subscription'. `paymentRow.user_id` was captured at order-creation time, so
 * no extra lookup is needed to notify the right owner.
 */
export const activateSubscriptionFromWebhook = async (paymentRow, razorpayPaymentId) => {
  const subscription = await subRepo.findById(paymentRow.payable_id);
  if (!subscription) return;

  await activateSubscription({
    paymentId: paymentRow.id,
    subscriptionId: subscription.id,
    businessId: subscription.business_id,
    razorpayPaymentId,
    notifyUserId: paymentRow.user_id,
  });
};
