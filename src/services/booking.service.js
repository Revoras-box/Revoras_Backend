import * as bookingRepo from "../repositories/booking.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as serviceRepo from "../repositories/service.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as notificationService from "./notification.service.js";
import * as offerEngine from "./offer.engine.js";
import * as stateMachine from "./bookingStateMachine.js";
import * as cancellationPolicy from "./cancellationPolicy.service.js";
import { ServiceError } from "../utils/ServiceError.js";
import { logger } from "../utils/logger.js";

const PG_EXCLUSION_VIOLATION = "23P01";

/**
 * Notifications are a best-effort side effect of a booking action that has
 * already committed - a transient failure here (a bad template, a DB hiccup)
 * must never surface as a failure of the booking action itself, or a client
 * would see a 500 for a booking that in fact succeeded. Logged, not thrown.
 */
const notifySafely = async (fn) => {
  try {
    await fn();
  } catch (err) {
    logger.error("Notification delivery failed", err);
  }
};

const addMinutesToTime = (timeValue, minutesToAdd) => {
  const [hourRaw = "0", minuteRaw = "0"] = String(timeValue).split(":");
  const totalMinutes = Number(hourRaw) * 60 + Number(minuteRaw) + Number(minutesToAdd || 0);
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
};

const timeToMinutes = (timeValue) => {
  if (!timeValue) return null;
  const [hourRaw, minuteRaw] = String(timeValue).split(":");
  return Number(hourRaw) * 60 + Number(minuteRaw);
};

const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

const normalizeTime = (value) => (String(value).length === 5 ? `${value}:00` : String(value));

const generateConfirmationCode = () =>
  `REV${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(0, 20);

const resolveServices = async (serviceIds, studioId) => {
  const normalizedIds = [...new Set(serviceIds.map(String))];
  const rows = await serviceRepo.findActiveByIdsForStudio(normalizedIds, studioId);

  if (rows.length !== normalizedIds.length) {
    throw new ServiceError(400, "One or more services not found for this business");
  }

  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const services = normalizedIds.map((id) => byId.get(id));

  const totalAmount = services.reduce((sum, s) => sum + Number(s.price), 0);
  const totalDuration = services.reduce((sum, s) => sum + Number(s.duration), 0);

  return { services, totalAmount, totalDuration };
};

const runConflictCheckedInsert = async (trx, { businessMemberId, studioId, insertRow, excludeBookingId }) => {
  await bookingRepo.acquireMemberLock(trx, businessMemberId);

  const member = await businessMemberRepo.findBookableMember({ id: businessMemberId, studioId }, trx);
  if (!member) {
    throw new ServiceError(404, "Professional not found or not currently bookable at this business");
  }

  const conflict = await bookingRepo.findConflict(trx, {
    businessMemberId,
    date: insertRow.booking_date,
    startTime: insertRow.start_time,
    endTime: insertRow.end_time,
    excludeBookingId,
  });

  if (conflict.conflict) {
    throw new ServiceError(
      409,
      conflict.reason === "blocked" ? "Professional is unavailable at this time" : "Time slot not available"
    );
  }
};

export const createBooking = async ({ userId, studioId, businessMemberId, serviceIds, date, startTime, notes }) => {
  if (!studioId || !businessMemberId || !serviceIds?.length || !date || !startTime) {
    throw new ServiceError(400, "Business, professional, services, date and time are required");
  }

  const appointmentDateTime = new Date(`${date}T${startTime}`);
  if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime <= new Date()) {
    throw new ServiceError(400, "Appointment must be in the future");
  }

  const { services, totalAmount, totalDuration } = await resolveServices(serviceIds, studioId);

  const normalizedStartTime = normalizeTime(startTime);
  const endTime = addMinutesToTime(normalizedStartTime, totalDuration);

  const booking = await bookingRepo.runInTransaction(async (trx) => {
    // Phase 2.4 (Offers & Promotions) - apply the single best offer the customer
    // qualifies for and snapshot it onto the booking (decision D1). Resolved
    // INSIDE the transaction so the usage-limit checks read the same committed
    // state the insert commits into. `total_amount` becomes the post-discount
    // payable figure - payment.service.js reads it unchanged. One offer_id =
    // no stacking.
    const best = await offerEngine.resolveBestOffer({ studioId, services, userId, db: trx });
    const discountAmount = best ? best.discountAmount : 0;
    const payableAmount = totalAmount - discountAmount;

    const insertRow = {
      user_id: userId,
      studio_id: studioId,
      business_member_id: businessMemberId,
      booking_date: date,
      start_time: normalizedStartTime,
      end_time: endTime,
      original_amount: totalAmount,
      discount_amount: discountAmount,
      offer_id: best ? best.offer.id : null,
      total_amount: payableAmount,
      total_duration: totalDuration,
      notes: notes || null,
      status: "pending",
    };

    await runConflictCheckedInsert(trx, { businessMemberId, studioId, insertRow });

    let created;
    try {
      created = await bookingRepo.insertBooking(trx, insertRow);
    } catch (err) {
      // Backstop: the pre-check above should already have caught this, but the
      // EXCLUDE constraint (report.md §3.5) is the real guarantee if it didn't.
      if (err.code === PG_EXCLUSION_VIOLATION) {
        throw new ServiceError(409, "Time slot not available");
      }
      throw err;
    }

    await bookingRepo.insertBookingServices(
      trx,
      services.map((s) => ({ booking_id: created.id, service_id: s.id, price: s.price, duration: s.duration }))
    );

    // Phase 2.5 - the first timeline entry (null -> pending), in the same tx so
    // a booking always has a creation event.
    await stateMachine.recordCreation(created.id, userId, trx);

    const confirmationCode = generateConfirmationCode();
    const withCode = await bookingRepo.setConfirmationCode(trx, created.id, confirmationCode);

    return { ...withCode, services };
  });

  await notifySafely(async () => {
    const business = await businessRepo.findById(studioId);
    await notificationService.notifyBookingCreated(userId, {
      businessName: business?.name || "your business",
      date: booking.booking_date,
      time: booking.start_time,
    });
  });

  return booking;
};

/**
 * Phase 2.4 - a pre-booking price quote: what will this cost, and which offer
 * (if any) applies, WITHOUT creating a booking. Backs the checkout's
 * "you save ₹X" line. Uses the exact same offer engine as createBooking, so the
 * quoted price and the charged price are computed by one code path and can't
 * disagree. Read-only, so it runs outside a transaction.
 */
export const quoteBooking = async ({ userId, studioId, serviceIds }) => {
  if (!studioId || !serviceIds?.length) {
    throw new ServiceError(400, "Business and services are required");
  }
  const { services, totalAmount } = await resolveServices(serviceIds, studioId);
  const best = await offerEngine.resolveBestOffer({ studioId, services, userId });
  const discountAmount = best ? best.discountAmount : 0;

  return {
    originalAmount: totalAmount,
    discountAmount,
    total: totalAmount - discountAmount,
    offer: best
      ? { id: best.offer.id, title: best.offer.title, label: offerEngine.toPublicOffer(best.offer).label }
      : null,
  };
};

// "upcoming"/"past"/"cancelled" (report.md Phase 2.4 plan) is a friendlier
// customer-facing lens on top of the raw `status` filter that already
// existed - both can be combined (e.g. category=upcoming&status=confirmed).
export const getUserBookings = async (userId, { status, category, page = 1, limit = 10 }) => {
  const { rows, total } = await bookingRepo.listForUser(userId, {
    status,
    category,
    page: Number(page),
    limit: Number(limit),
  });

  return {
    // Phase 2.5 - same contract as getBookingDetail and the business board:
    // the state machine is the single authority on what may happen next, so a
    // list UI renders only the actions that will actually succeed instead of
    // re-implementing the transition matrix client-side.
    bookings: rows.map((b) => ({ ...b, allowedNextStatuses: stateMachine.allowedNextStatuses(b.status) })),
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit)),
    },
  };
};

export const getBookingDetail = async (id, userId) => {
  const booking = await bookingRepo.findDetailForUser(id, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");
  // Phase 2.5 - the legal next moves come from the state machine (one
  // authority), so the client renders exactly the buttons that will succeed.
  return { ...booking, allowedNextStatuses: stateMachine.allowedNextStatuses(booking.status) };
};

/**
 * Phase 2.5 - what would cancelling this booking cost right now? Backs the
 * policy-aware cancel UI (Free / X% fee / Not cancellable) without cancelling.
 */
export const getCancellationQuote = async (id, userId) => {
  const booking = await bookingRepo.findByIdForUser(id, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");
  const business = await businessRepo.findById(booking.studio_id);
  return cancellationPolicy.evaluate(booking, business?.cancellation_policy);
};

export const cancelBooking = async (id, userId, reason) => {
  const booking = await bookingRepo.findByIdForUser(id, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");

  // The state machine rejects cancelling a terminal booking (completed/
  // cancelled/no_show); the policy decides whether an otherwise-cancellable one
  // is inside its no-cancel cutoff and what fee applies.
  const business = await businessRepo.findById(booking.studio_id);
  const outcome = cancellationPolicy.evaluate(booking, business?.cancellation_policy);
  if (!outcome.cancellable) {
    throw new ServiceError(400, outcome.message || "This booking can no longer be cancelled online. Please contact the studio.");
  }

  await stateMachine.transition(booking, "cancelled", {
    actorType: "customer",
    actorId: userId,
    reason: reason || "Cancelled by customer",
    // Freeze the computed fee on the booking (decision D3 - recorded, not yet
    // refunded/charged).
    extraPatch: { cancellation_reason: reason || "Cancelled by customer", cancellation_fee: outcome.feeAmount },
  });

  await notifySafely(async () => {
    await notificationService.notifyBookingCancelled(userId, {
      businessName: business?.name || "your business",
      date: booking.booking_date,
      time: booking.start_time,
    });
  });

  return outcome;
};

export const rescheduleBooking = async (id, userId, { date, startTime }) => {
  if (!date || !startTime) throw new ServiceError(400, "New date and time required");

  const booking = await bookingRepo.findByIdForUser(id, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");
  // Only a still-open booking can move. checked_in means the customer has
  // arrived - reschedule no longer makes sense.
  if (!["pending", "confirmed"].includes(booking.status)) {
    throw new ServiceError(400, `A ${booking.status} booking can't be rescheduled.`);
  }

  // Same last-minute cutoff as cancellation: you can't reschedule a booking you
  // couldn't cancel (reuses the business's policy, no separate rule to keep in
  // sync). Reschedules never carry a fee.
  const business = await businessRepo.findById(booking.studio_id);
  const policy = cancellationPolicy.evaluate(booking, business?.cancellation_policy);
  if (policy.tier === "blocked") {
    throw new ServiceError(400, `This booking can't be rescheduled within ${policy.policy.noCancelWithinHours}h of the appointment.`);
  }

  const newDateTime = new Date(`${date}T${startTime}`);
  if (Number.isNaN(newDateTime.getTime()) || newDateTime <= new Date()) {
    throw new ServiceError(400, "New appointment must be in the future");
  }

  const normalizedStartTime = normalizeTime(startTime);
  const endTime = addMinutesToTime(normalizedStartTime, Number(booking.total_duration || 0));

  // In-place update - the same booking row moves, no new booking is created
  // (roadmap: "No duplicate booking creation"). A timeline event records the
  // move without changing status (from == to).
  await bookingRepo.runInTransaction(async (trx) => {
    await runConflictCheckedInsert(trx, {
      businessMemberId: booking.business_member_id,
      studioId: booking.studio_id,
      insertRow: { booking_date: date, start_time: normalizedStartTime, end_time: endTime },
      excludeBookingId: id,
    });

    try {
      await bookingRepo.updateReschedule(trx, id, { date, startTime: normalizedStartTime, endTime });
    } catch (err) {
      if (err.code === PG_EXCLUSION_VIOLATION) {
        throw new ServiceError(409, "New time slot not available");
      }
      throw err;
    }

    await bookingRepo.insertStatusEvent(
      {
        bookingId: id,
        fromStatus: booking.status,
        toStatus: booking.status,
        actorType: "customer",
        actorId: userId,
        reason: `Rescheduled to ${date} ${normalizedStartTime.slice(0, 5)}`,
      },
      trx
    );
  });
};

export const getAvailability = async ({ businessMemberId, date, duration }) => {
  if (!businessMemberId || !date) {
    throw new ServiceError(400, "Professional ID and date are required");
  }

  const defaultSlots = [
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "12:00", "12:30", "13:00", "13:30", "14:00", "14:30",
    "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
    "18:00", "18:30", "19:00", "19:30", "20:00",
  ];

  const slotDuration = Math.max(Number(duration) || 30, 30);

  const [bookedRows, blockedRows] = await Promise.all([
    bookingRepo.findBookingsForMemberOnDate(businessMemberId, date),
    bookingRepo.findTimeOffForMemberOnDate(businessMemberId, date),
  ]);

  if (blockedRows.some((row) => row.is_full_day)) {
    return { slots: [] };
  }

  const occupiedRanges = [...bookedRows, ...blockedRows]
    .map((row) => [timeToMinutes(row.start_time), timeToMinutes(row.end_time)])
    .filter(([start, end]) => start !== null && end !== null);

  let availableSlots = defaultSlots.filter((slot) => {
    const slotStart = timeToMinutes(slot);
    const slotEnd = slotStart + slotDuration;
    return !occupiedRanges.some(([start, end]) => rangesOverlap(slotStart, slotEnd, start, end));
  });

  const today = new Date().toISOString().split("T")[0];
  if (date === today) {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    availableSlots = availableSlots.filter((slot) => slot > currentTime);
  }

  return { slots: availableSlots };
};

// GET /api/business/:studioId/bookings - the business-side counterpart to
// getUserBookings, filterable across the whole appointment book rather than
// one customer's own bookings.
export const listBusinessBookings = async (
  studioId,
  { search, from, to, businessMemberId, status, paymentStatus, page = 1, limit = 20 }
) => {
  const { rows, total } = await bookingRepo.listForStudio(studioId, {
    search,
    from,
    to,
    businessMemberId,
    status,
    paymentStatus,
    page: Number(page),
    limit: Number(limit),
  });

  return {
    // Phase 2.5 - each row carries its legal next transitions so the booking
    // board shows only the actions the state machine will accept.
    bookings: rows.map((b) => ({ ...b, allowedNextStatuses: stateMachine.allowedNextStatuses(b.status) })),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  };
};

// PATCH /api/business/:studioId/bookings/:id - reschedule and/or reassign,
// e.g. calendar drag-and-drop. Reuses the same conflict-check/lock/exclusion-
// violation pattern as the customer-facing rescheduleBooking above.
export const rescheduleBusinessBooking = async (studioId, bookingId, { bookingDate, startTime, businessMemberId }) => {
  const booking = await bookingRepo.findByIdForStudio(bookingId, studioId);
  if (!booking) throw new ServiceError(404, "Booking not found");
  if (["cancelled", "completed"].includes(booking.status)) {
    throw new ServiceError(400, "Cannot reschedule this booking");
  }

  const targetMemberId = businessMemberId || booking.business_member_id;
  const targetDate = bookingDate || booking.booking_date;
  const normalizedStartTime = startTime ? normalizeTime(startTime) : normalizeTime(booking.start_time);
  const endTime = addMinutesToTime(normalizedStartTime, Number(booking.total_duration || 0));

  await bookingRepo.runInTransaction(async (trx) => {
    await runConflictCheckedInsert(trx, {
      businessMemberId: targetMemberId,
      studioId,
      insertRow: { booking_date: targetDate, start_time: normalizedStartTime, end_time: endTime },
      excludeBookingId: bookingId,
    });

    try {
      await bookingRepo.updateBusinessReschedule(trx, bookingId, {
        date: bookingDate ? targetDate : undefined,
        startTime: startTime ? normalizedStartTime : undefined,
        endTime: startTime || businessMemberId ? endTime : undefined,
        businessMemberId: businessMemberId || undefined,
      });
    } catch (err) {
      if (err.code === PG_EXCLUSION_VIOLATION) {
        throw new ServiceError(409, "Time slot not available");
      }
      throw err;
    }
  });
};

// PATCH /api/business/:studioId/bookings/:id/status - business-initiated
// transitions (confirm/check-in/complete/cancel/no-show). Legality is decided
// by the state machine (decision D1), not re-checked here: an illegal move like
// pending -> completed is a 400 from one authority.
export const updateBusinessBookingStatus = async (studioId, bookingId, status, actorId, reason) => {
  const booking = await bookingRepo.findByIdForStudio(bookingId, studioId);
  if (!booking) throw new ServiceError(404, "Booking not found");

  await stateMachine.transition(booking, status, { actorType: "business", actorId, reason });
};

// Phase 2.5 - the booking timeline (status events, oldest first).
export const getBookingTimeline = (bookingId) => bookingRepo.listStatusEvents(bookingId);
