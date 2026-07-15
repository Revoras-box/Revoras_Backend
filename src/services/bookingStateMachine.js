import * as bookingRepo from "../repositories/booking.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Phase 2.5 (Booking Experience) - the SINGLE authority for booking status
 * transitions (decision D1). Every status change in the system - customer
 * cancel, business confirm/check-in/complete/no-show, and the initial creation
 * event - goes through `transition()` here. Nothing else calls
 * bookingRepo.updateStatus directly.
 *
 * The matrix is the whole point: an illegal move (e.g. pending -> completed,
 * skipping confirm/check-in) is a 400, decided in one place, so the timeline
 * and every downstream metric (completion rate, no-show rate) can trust that a
 * booking only ever moved through legal states.
 */
export const STATUSES = ["pending", "confirmed", "checked_in", "completed", "cancelled", "no_show"];

export const TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["completed", "no_show"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const isTerminal = (status) => TRANSITIONS[status]?.length === 0;

export const canTransition = (from, to) => Boolean(TRANSITIONS[from]?.includes(to));

/** The moves currently legal from a booking's status - drives which action buttons a client shows. */
export const allowedNextStatuses = (status) => TRANSITIONS[status] ?? [];

/**
 * Apply a transition: validate legality, update the booking, and append a
 * status event (the timeline row) - atomically. Callers pass their own `trx`
 * when the transition is part of a larger transaction (e.g. cancel + record a
 * fee); otherwise one is opened here.
 *
 * `extraPatch` lets a caller set booking columns that belong to the same state
 * change (cancellation_reason, cancellation_fee) in the same write.
 */
export const transition = async (booking, toStatus, { actorType, actorId = null, reason = null, extraPatch = {} } = {}, db) => {
  if (!STATUSES.includes(toStatus)) {
    throw new ServiceError(400, `Unknown booking status "${toStatus}"`);
  }
  const from = booking.status;
  if (!canTransition(from, toStatus)) {
    const hint = isTerminal(from)
      ? `This booking is already ${from} and can't change.`
      : `Can't move a ${from} booking to ${toStatus}.`;
    throw new ServiceError(400, hint);
  }
  if (!actorType) throw new ServiceError(500, "transition() requires an actorType");

  const run = async (trx) => {
    const updated = await bookingRepo.updateStatus(booking.id, toStatus, extraPatch, trx);
    await bookingRepo.insertStatusEvent(
      { bookingId: booking.id, fromStatus: from, toStatus, actorType, actorId, reason },
      trx
    );
    return updated;
  };

  return db ? run(db) : bookingRepo.runInTransaction(run);
};

/**
 * Record the booking-creation event (from_status = null -> pending). Called
 * right after a booking row is inserted, inside the same transaction, so a
 * booking always has a first timeline entry.
 */
export const recordCreation = (bookingId, actorId, db) =>
  bookingRepo.insertStatusEvent(
    { bookingId, fromStatus: null, toStatus: "pending", actorType: "customer", actorId, reason: "Booking created" },
    db
  );
