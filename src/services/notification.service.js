import * as notificationRepo from "../repositories/notification.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

export const list = async (userId, { unreadOnly, page = 1, limit = 20 }) => {
  const { rows, total } = await notificationRepo.listForUser(userId, {
    unreadOnly,
    page: Number(page),
    limit: Number(limit),
  });
  return {
    notifications: rows,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
  };
};

export const unreadCount = (userId) => notificationRepo.countUnread(userId);

export const markRead = async (userId, id) => {
  const updated = await notificationRepo.markRead(id, userId);
  if (updated) return updated;

  // markRead's WHERE excludes already-read rows, so a no-op update doesn't
  // by itself mean "not found" - check separately before treating it as 404,
  // marking an already-read notification read again should be a harmless no-op.
  const existing = await notificationRepo.findByIdForUser(id, userId);
  if (!existing) throw new ServiceError(404, "Notification not found");
  return existing;
};

export const markAllRead = (userId) => notificationRepo.markAllRead(userId);

/**
 * Real, DB-persisted notifications (report.md Phase 2.4 plan - "do not rely
 * on transient in-memory notifications"). These helpers are called directly
 * by booking.service.js/payment.service.js at the moments they name, not
 * exposed as routes themselves - notifications are a side effect of booking/
 * payment actions, not their own writable resource from the client's side.
 */
const TEMPLATES = {
  booking_created: (d) => ({
    title: "Booking requested",
    message: `Your booking at ${d.businessName} for ${d.date} at ${d.time} has been requested and is awaiting confirmation.`,
  }),
  booking_confirmed: (d) => ({
    title: "Booking confirmed",
    message: `Your booking at ${d.businessName} for ${d.date} at ${d.time} is confirmed.`,
  }),
  booking_cancelled: (d) => ({
    title: "Booking cancelled",
    message: `Your booking at ${d.businessName} for ${d.date} at ${d.time} was cancelled.`,
  }),
  booking_reminder: (d) => ({
    title: "Upcoming appointment",
    message: `Reminder: you have an appointment at ${d.businessName} on ${d.date} at ${d.time}.`,
  }),
  payment_received: (d) => ({
    title: "Payment received",
    message: `We received your payment of ₹${d.amount} for your booking at ${d.businessName}.`,
  }),
  subscription_activated: (d) => ({
    title: "Subscription activated",
    message: `Your ₹${d.amount}/month subscription for ${d.businessName} is active. Your business has been submitted for review.`,
  }),
};

const notify = (userId, type, data) => {
  const { title, message } = TEMPLATES[type](data);
  return notificationRepo.create({ user_id: userId, type, title, message, data: JSON.stringify(data) });
};

export const notifyBookingCreated = (userId, data) => notify(userId, "booking_created", data);
export const notifyBookingConfirmed = (userId, data) => notify(userId, "booking_confirmed", data);
export const notifyBookingCancelled = (userId, data) => notify(userId, "booking_cancelled", data);
// Not yet wired to an automatic trigger - no job scheduler exists in this
// codebase yet (flagged as tech debt in the Phase 2.4 deliverable). The
// function itself is complete and ready for a future cron/job runner to call.
export const notifyBookingReminder = (userId, data) => notify(userId, "booking_reminder", data);
export const notifyPaymentReceived = (userId, data) => notify(userId, "payment_received", data);
export const notifySubscriptionActivated = (userId, data) => notify(userId, "subscription_activated", data);
