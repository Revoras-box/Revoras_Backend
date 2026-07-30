import * as bookingRepo from "../repositories/booking.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as serviceRepo from "../repositories/service.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as userRepo from "../repositories/user.repository.js";
import * as notificationService from "./notification.service.js";
import * as offerEngine from "./offer.engine.js";
import * as stateMachine from "./bookingStateMachine.js";
import * as cancellationPolicy from "./cancellationPolicy.service.js";
import * as reschedulePolicy from "./reschedulePolicy.service.js";
import * as availabilityService from "./availability.service.js";
import * as employeeServiceService from "./employeeService.service.js";
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

const normalizeTime = (value) => (String(value).length === 5 ? `${value}:00` : String(value));

const generateConfirmationCode = () =>
  `REV${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`.slice(0, 20);

/**
 * The basket, priced and timed for the professional who will actually do it.
 *
 * `businessMemberId` is what makes this per-employee: the same haircut is 25
 * minutes with one barber and 40 with another, and the booking has to reserve
 * the right amount of the RIGHT person's day. Availability sizes its grid
 * through the same resolver, so a slot offered is a slot that fits.
 *
 * Without a member (the standalone price quote, which happens before the
 * customer has chosen a chair) it falls back to catalogue figures - a quote is
 * an estimate, and it is re-quoted for real once a professional is picked.
 */
const resolveServices = async (serviceIds, studioId, businessMemberId) => {
  const normalizedIds = [...new Set(serviceIds.map(String))];

  const services = businessMemberId
    ? await employeeServiceService.resolveBasketForMember(businessMemberId, studioId, normalizedIds)
    : await (async () => {
        const rows = await serviceRepo.findActiveByIdsForStudio(normalizedIds, studioId);
        if (rows.length !== normalizedIds.length) {
          throw new ServiceError(400, "One or more services not found for this business");
        }
        const byId = new Map(rows.map((row) => [String(row.id), row]));
        return normalizedIds.map((id) => byId.get(id));
      })();

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

export const createBooking = async ({
  userId,
  studioId,
  businessMemberId,
  serviceIds,
  date,
  startTime,
  notes,
  // Reschedule Protection: the checkout checkbox. `true` buys the right to move
  // this appointment until the cutoff; anything falsy is a recorded decline, not
  // an absence of a decision (see the migration's note on why NULL is reserved
  // for pre-feature bookings).
  rescheduleAddon = false,
}) => {
  if (!studioId || !businessMemberId || !serviceIds?.length || !date || !startTime) {
    throw new ServiceError(400, "Business, professional, services, date and time are required");
  }

  const appointmentDateTime = new Date(`${date}T${startTime}`);
  if (Number.isNaN(appointmentDateTime.getTime()) || appointmentDateTime <= new Date()) {
    throw new ServiceError(400, "Appointment must be in the future");
  }

  const { services, totalAmount, totalDuration } = await resolveServices(serviceIds, studioId, businessMemberId);

  const normalizedStartTime = normalizeTime(startTime);
  const endTime = addMinutesToTime(normalizedStartTime, totalDuration);

  // Needed before the insert (the business's live reschedule terms) as well as
  // after it (the notification's business name), so it's fetched once.
  const business = await businessRepo.findById(studioId);

  // The add-on is only sellable if this business offers it. A client that asks
  // for protection at a business that has switched it off gets a booking with
  // no protection and no charge, rather than a silent ₹0 "protected" booking.
  const addonQuote = reschedulePolicy.quoteAddon(business?.reschedule_policy);
  const addonPurchased = Boolean(rescheduleAddon) && addonQuote.offered;
  const addonFee = addonPurchased ? addonQuote.feeAmount : 0;

  const booking = await bookingRepo.runInTransaction(async (trx) => {
    // Phase 2.4 (Offers & Promotions) - apply the single best offer the customer
    // qualifies for and snapshot it onto the booking (decision D1). Resolved
    // INSIDE the transaction so the usage-limit checks read the same committed
    // state the insert commits into. `total_amount` becomes the post-discount
    // payable figure - payment.service.js reads it unchanged. One offer_id =
    // no stacking.
    const best = await offerEngine.resolveBestOffer({ studioId, services, userId, db: trx });
    const discountAmount = best ? best.discountAmount : 0;
    // The add-on rides on top of the discounted services total: it's a fee for a
    // right, not a service, so an offer must never discount it. Because payment
    // reads `total_amount`, adding it here is what makes the customer actually
    // pay for the protection - no separate charge path.
    const payableAmount = totalAmount - discountAmount + addonFee;

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
      // A real recorded choice either way (never NULL - that's reserved for
      // bookings made before this feature existed).
      reschedule_addon: addonPurchased,
      reschedule_addon_fee: addonFee,
      // Freeze the terms as purchased. If the owner later raises the fee or
      // tightens the cutoff, this booking is still judged by what was bought.
      reschedule_terms: addonPurchased
        ? JSON.stringify({
            feeAmount: addonQuote.feeAmount,
            cutoffHours: addonQuote.cutoffHours,
            maxReschedules: addonQuote.maxReschedules,
          })
        : null,
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
export const quoteBooking = async ({ userId, studioId, serviceIds, businessMemberId }) => {
  if (!studioId || !serviceIds?.length) {
    throw new ServiceError(400, "Business and services are required");
  }
  // Once the customer has picked a chair the quote is priced and timed for that
  // person; before that it's the catalogue estimate.
  const { services, totalAmount, totalDuration } = await resolveServices(serviceIds, studioId, businessMemberId);
  const [best, business] = await Promise.all([
    offerEngine.resolveBestOffer({ studioId, services, userId }),
    businessRepo.findById(studioId),
  ]);
  const discountAmount = best ? best.discountAmount : 0;

  return {
    originalAmount: totalAmount,
    discountAmount,
    // `total` stays the services-only payable figure. The add-on is optional and
    // unticked by default, so folding it in here would quote a price for
    // something the customer hasn't chosen; checkout adds `rescheduleAddon.fee`
    // to this when the box is ticked.
    total: totalAmount - discountAmount,
    totalDuration,
    offer: best
      ? { id: best.offer.id, title: best.offer.title, label: offerEngine.toPublicOffer(best.offer).label }
      : null,
    // The Reschedule Protection offer, straight from this business's own terms,
    // so the checkbox's price and cutoff are the ones that get enforced.
    rescheduleAddon: reschedulePolicy.quoteAddon(business?.reschedule_policy),
  };
};

/**
 * The engine's verdict in the shape the client consumes. Every route that
 * exposes eligibility goes through this one mapper - the embedded `reschedule`
 * field on a booking and the standalone quote endpoint return the identical
 * object, so a client can read `allowed` without caring which call it came from.
 * (They diverged once: the quote endpoint returned the raw engine shape, whose
 * flag is `reschedulable`, and the modal read `allowed` as undefined and
 * declared every booking un-movable.)
 */
const toEligibility = (outcome) => ({
  allowed: outcome.reschedulable,
  protected: outcome.protected,
  reason: outcome.reason,
  message: outcome.message,
  cutoffHours: outcome.cutoffHours,
  deadline: outcome.deadline,
  reschedulesRemaining: outcome.reschedulesRemaining,
});

/**
 * Attach the reschedule verdict to a booking row that already carries its
 * business's policies (the list/detail queries join them in). The engine is the
 * only thing that decides eligibility - the client renders `reschedule.allowed`
 * and `reschedule.message` rather than re-deriving the cutoff, which would be a
 * second copy of the rule free to drift from this one.
 *
 * The raw policy columns are dropped on the way out: they're join fodder for this
 * computation, not part of a booking's public shape.
 */
const withReschedule = (row) => {
  const { reschedule_policy, cancellation_policy, ...booking } = row;
  const cancellation = cancellationPolicy.evaluate(row, cancellation_policy);

  const outcome = reschedulePolicy.evaluate(row, reschedule_policy, {
    legacy: { blocked: cancellation.tier === "blocked", cutoffHours: cancellation.policy.noCancelWithinHours },
  });

  return { ...booking, reschedule: toEligibility(outcome) };
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
    bookings: rows.map((b) => ({
      ...withReschedule(b),
      allowedNextStatuses: stateMachine.allowedNextStatuses(b.status),
    })),
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
  // `reschedule` is the same idea for the Reschedule button.
  return { ...withReschedule(booking), allowedNextStatuses: stateMachine.allowedNextStatuses(booking.status) };
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

/**
 * Reschedule eligibility for one booking, evaluated by the reschedule engine.
 * Backs the "Reschedule" button: the UI shows it only when `reschedulable`, and
 * shows `message` (the real reason and deadline) when it doesn't.
 */
export const getRescheduleQuote = async (id, userId) => {
  const booking = await bookingRepo.findByIdForUser(id, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");
  // Same mapper as the embedded `reschedule` field - one contract, both routes.
  return toEligibility(await evaluateReschedule(booking));
};

/**
 * Both the quote and the action have to reach the same verdict, so they share
 * this. The cancellation policy is consulted only to reproduce the pre-add-on
 * behaviour for grandfathered bookings (`reschedule_addon IS NULL`) - for a
 * booking that made an add-on decision, the reschedule terms are the authority,
 * because that's what the customer paid for.
 */
const evaluateReschedule = async (booking) => {
  const business = await businessRepo.findById(booking.studio_id);
  const cancellation = cancellationPolicy.evaluate(booking, business?.cancellation_policy);

  return reschedulePolicy.evaluate(booking, business?.reschedule_policy, {
    legacy: {
      blocked: cancellation.tier === "blocked",
      cutoffHours: cancellation.policy.noCancelWithinHours,
    },
  });
};

export const rescheduleBooking = async (id, userId, { date, startTime }) => {
  if (!date || !startTime) throw new ServiceError(400, "New date and time required");

  const booking = await bookingRepo.findByIdForUser(id, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");

  // One authority for every reschedule rule: still-open status, the paid add-on,
  // the cutoff before the appointment, and the moves already used. The message
  // the customer was shown by the quote endpoint is the message they get here.
  const outcome = await evaluateReschedule(booking);
  if (!outcome.reschedulable) {
    throw new ServiceError(400, outcome.message);
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

    let moved;
    try {
      moved = await bookingRepo.updateReschedule(trx, id, {
        date,
        startTime: normalizedStartTime,
        endTime,
        // The allowance is re-asserted in the UPDATE's WHERE clause. Only a
        // purchased add-on carries a limit; a grandfathered booking has none, so
        // passing undefined leaves it unguarded exactly as before.
        maxReschedules: outcome.protected ? outcome.terms.maxReschedules : undefined,
      });
    } catch (err) {
      if (err.code === PG_EXCLUSION_VIOLATION) {
        throw new ServiceError(409, "New time slot not available");
      }
      throw err;
    }

    // Zero rows means the guard above rejected it - a concurrent reschedule
    // spent the last move between our check and this write.
    if (!moved) {
      throw new ServiceError(409, "This booking has already been rescheduled. Please reload and try again.");
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

  // Both sides need to know the appointment moved: the customer gets their
  // confirmation, and the studio can't be left holding a stale time in its book.
  // Best-effort - the move has already committed.
  await notifySafely(async () => {
    const [business, customer, recipients] = await Promise.all([
      businessRepo.findById(booking.studio_id),
      userRepo.findById(userId),
      // The studio side: the professional whose day just changed, plus the owners.
      businessMemberRepo.listNotifiableUserIds(booking.studio_id, booking.business_member_id),
    ]);

    const businessName = business?.name || "your business";
    const from = { date: booking.booking_date, time: booking.start_time };
    const to = { date, time: normalizedStartTime };

    await notificationService.notifyBookingRescheduled(userId, { businessName, from, to });

    await Promise.all(
      recipients
        // An owner who books at their own studio would otherwise be told twice.
        .filter((recipientId) => recipientId !== userId)
        .map((recipientId) =>
          notificationService.notifyBusinessBookingRescheduled(recipientId, {
            businessName,
            customerName: customer?.name || "A customer",
            confirmationCode: booking.confirmation_code,
            from,
            to,
          })
        )
    );
  });
};

/**
 * Availability now lives in availability.service.js, which reads the shop's and
 * the professional's real schedules instead of the hardcoded 09:00-20:00 grid
 * this used to return. Re-exported so existing callers keep working.
 */
export const getAvailability = availabilityService.getAvailability;

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

  // The customer has to hear about this. An owner dragging a booking on the
  // calendar changes when someone is expected to turn up, and until now that
  // moved silently. Only sent when the time actually moved - a pure reassignment
  // to another professional doesn't change when they need to be there.
  const timeChanged =
    (bookingDate && String(targetDate) !== String(booking.booking_date)) ||
    (startTime && normalizedStartTime !== normalizeTime(booking.start_time));

  if (timeChanged) {
    await notifySafely(async () => {
      const business = await businessRepo.findById(studioId);
      await notificationService.notifyBookingRescheduled(booking.user_id, {
        businessName: business?.name || "your business",
        from: { date: booking.booking_date, time: booking.start_time },
        to: { date: targetDate, time: normalizedStartTime },
      });
    });
  }
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
