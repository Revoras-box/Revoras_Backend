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
/**
 * "Mon 4 Aug at 4:30 PM" from a `{ date, time }` pair.
 *
 * The two sides of a reschedule arrive in different shapes - the old date comes
 * off the booking row as a Date (Postgres `date`), the new one as the "YYYY-MM-DD"
 * string the client sent - so both are normalized here rather than at each call
 * site. Time is "HH:MM:SS" from Postgres; seconds are never interesting to a
 * reader. Falls back to the raw values if either is unparseable, so a template
 * can't throw and take a real booking action's notification down with it.
 */
const fmtWhen = ({ date, time } = {}) => {
  const d = date instanceof Date ? date : new Date(`${date}T00:00:00`);
  const [hh, mm] = String(time ?? "").split(":").map(Number);

  if (Number.isNaN(d.getTime()) || !Number.isFinite(hh)) return `${date} at ${time}`;

  const day = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const clock = `${hh % 12 || 12}:${String(mm || 0).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
  return `${day} at ${clock}`;
};

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
  // Both sides of a reschedule. The old time is spelled out as well as the new
  // one: "your booking is now at 4pm" is useless to someone who has forgotten
  // which of their bookings moved, and the studio needs to know which slot in
  // its book just freed up.
  booking_rescheduled: (d) => ({
    title: "Appointment rescheduled",
    message: `Your appointment at ${d.businessName} has moved from ${fmtWhen(d.from)} to ${fmtWhen(d.to)}.`,
  }),
  business_booking_rescheduled: (d) => ({
    title: "A customer rescheduled",
    message:
      `${d.customerName} moved their appointment${d.confirmationCode ? ` (${d.confirmationCode})` : ""} ` +
      `from ${fmtWhen(d.from)} to ${fmtWhen(d.to)}. The original slot is free again.`,
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
export const notifyBookingRescheduled = (userId, data) => notify(userId, "booking_rescheduled", data);
// Sent to the studio's owners and the assigned professional, not the customer.
export const notifyBusinessBookingRescheduled = (userId, data) =>
  notify(userId, "business_booking_rescheduled", data);
// Not yet wired to an automatic trigger - no job scheduler exists in this
// codebase yet (flagged as tech debt in the Phase 2.4 deliverable). The
// function itself is complete and ready for a future cron/job runner to call.
export const notifyBookingReminder = (userId, data) => notify(userId, "booking_reminder", data);
export const notifyPaymentReceived = (userId, data) => notify(userId, "payment_received", data);
export const notifySubscriptionActivated = (userId, data) => notify(userId, "subscription_activated", data);
