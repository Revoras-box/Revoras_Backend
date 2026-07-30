import * as stateMachine from "./bookingStateMachine.js";

/**
 * The Reschedule Protection engine - one place that decides whether a booking
 * may still be moved, and what the add-on costs to buy in the first place.
 *
 * The rule this implements: rescheduling is a paid, opt-in add-on chosen at
 * checkout. A customer who bought it can move the appointment right up to a
 * cutoff before it starts (default 2h); after that nobody can move it online.
 * A customer who was offered it and declined can't move the booking at all -
 * that's what they're paying for.
 *
 * Nothing here is hardcoded per business. `businesses.reschedule_policy` holds
 * the terms (offered at all? what fee? what cutoff? how many moves?) and the
 * defaults below are only what a business inherits until it saves its own.
 *
 * Same shape and division of labour as cancellationPolicy.service.js: this
 * computes and returns a verdict, callers act on it. The checkout quote, the
 * eligibility endpoint and the reschedule action all call this, so what the
 * customer is shown is what actually gets enforced.
 */
const DEFAULT_POLICY = {
  enabled: true,
  feeAmount: 2,
  cutoffHours: 2,
  maxReschedules: 1,
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Coerce whatever is in the JSONB column into a complete, sane set of terms.
 * Every field falls back independently, so a partially-written policy row
 * (`{ feeAmount: 5 }`) still yields usable terms instead of NaN leaking into a
 * price or a cutoff comparison.
 */
export const normalizePolicy = (rawPolicy) => {
  const p = rawPolicy || {};
  const num = (value, fallback, min) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };

  return {
    // Only an explicit `false` turns the add-on off; anything else (including a
    // policy row that predates the flag) leaves it offered.
    enabled: p.enabled !== false,
    feeAmount: round2(num(p.feeAmount, DEFAULT_POLICY.feeAmount, 0)),
    cutoffHours: num(p.cutoffHours, DEFAULT_POLICY.cutoffHours, 0),
    // At least one move, or buying the add-on would grant nothing.
    maxReschedules: Math.max(1, Math.floor(num(p.maxReschedules, DEFAULT_POLICY.maxReschedules, 1))),
  };
};

/**
 * Same local-wall-clock reconstruction as cancellationPolicy.service.js.
 * `booking.booking_date` arrives from the driver as a Date (Postgres `date` ->
 * local-midnight Date), so the naive `` `${booking_date}T${start_time}` ``
 * template yields "Invalid Date" -> NaN, and every hours-until comparison
 * silently passes. Build from calendar components instead.
 */
const appointmentDate = (booking) => {
  const d = booking.booking_date instanceof Date ? booking.booking_date : new Date(booking.booking_date);
  const [hh = 0, mm = 0] = String(booking.start_time).split(":").map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
};

const hoursUntil = (booking, now) => (appointmentDate(booking).getTime() - now.getTime()) / (1000 * 60 * 60);

/** The exact moment rescheduling closes, so the UI can show a real deadline. */
const deadlineFor = (booking, cutoffHours) =>
  new Date(appointmentDate(booking).getTime() - cutoffHours * 60 * 60 * 1000);

/**
 * What to offer at checkout for this business: the add-on's real price and
 * terms, or `offered: false` if the owner has switched it off. Backs the
 * checkbox, so the customer sees the same numbers that will be charged and
 * later enforced.
 */
export const quoteAddon = (rawPolicy) => {
  const terms = normalizePolicy(rawPolicy);
  return {
    offered: terms.enabled,
    feeAmount: terms.feeAmount,
    cutoffHours: terms.cutoffHours,
    maxReschedules: terms.maxReschedules,
  };
};

/**
 * The terms to judge an existing booking by. `reschedule_terms` is the snapshot
 * taken when the customer paid; the live policy is only a fallback for bookings
 * that have no snapshot. Judging a paid booking by terms the owner changed
 * afterwards would retroactively rewrite what someone bought.
 */
const termsFor = (booking, rawPolicy) =>
  normalizePolicy(booking.reschedule_terms || rawPolicy);

/**
 * @param {object} booking          the booking row
 * @param {object} rawPolicy        businesses.reschedule_policy (live terms)
 * @param {object} [options]
 * @param {Date}   [options.now]
 * @param {object} [options.legacy] verdict for bookings with no add-on decision
 *   recorded (`reschedule_addon IS NULL` - booked before this feature shipped).
 *   `{ blocked, cutoffHours }`, normally derived from the cancellation policy by
 *   the caller so grandfathered bookings keep exactly the behaviour they had.
 *
 * @returns {{ reschedulable: boolean, reason: string, protected: boolean,
 *   terms: object, hoursUntil: number, cutoffHours: number,
 *   reschedulesUsed: number, reschedulesRemaining: number,
 *   deadline: string|null, message: string }}
 */
export const evaluate = (booking, rawPolicy, { now = new Date(), legacy } = {}) => {
  const terms = termsFor(booking, rawPolicy);
  const used = Number(booking.reschedule_count) || 0;
  const h = hoursUntil(booking, now);

  // `null` = grandfathered, `true` = bought protection, `false` = declined it.
  const hasProtection = booking.reschedule_addon === true;
  const declined = booking.reschedule_addon === false;

  const base = {
    reschedulable: false,
    protected: hasProtection,
    terms,
    hoursUntil: h,
    cutoffHours: terms.cutoffHours,
    reschedulesUsed: used,
    reschedulesRemaining: Math.max(0, terms.maxReschedules - used),
    deadline: deadlineFor(booking, terms.cutoffHours).toISOString(),
  };

  // A booking that can't be cancelled can't be moved either: completed,
  // cancelled and no_show are terminal, and checked_in means the customer has
  // already arrived. One authority for "is this booking still open".
  if (!["pending", "confirmed"].includes(booking.status)) {
    return { ...base, reason: "terminal", message: `A ${booking.status} booking can't be rescheduled.` };
  }

  // Grandfathered: no add-on decision was ever offered on this booking, so it
  // keeps the pre-feature behaviour rather than being retroactively locked out.
  if (!hasProtection && !declined) {
    const blocked = Boolean(legacy?.blocked);
    const legacyCutoff = Number.isFinite(legacy?.cutoffHours) ? legacy.cutoffHours : terms.cutoffHours;
    return blocked
      ? {
          ...base,
          reason: "cutoff",
          cutoffHours: legacyCutoff,
          deadline: deadlineFor(booking, legacyCutoff).toISOString(),
          message: `This booking can't be rescheduled within ${legacyCutoff}h of the appointment.`,
        }
      : {
          ...base,
          reschedulable: true,
          reason: "legacy",
          cutoffHours: legacyCutoff,
          deadline: deadlineFor(booking, legacyCutoff).toISOString(),
          message: "You can move this appointment to another time.",
        };
  }

  if (declined) {
    return {
      ...base,
      reason: "not_purchased",
      message:
        "Reschedule protection wasn't added to this booking, so it can't be moved online. " +
        "You can cancel it under the studio's cancellation policy, or contact the studio.",
    };
  }

  // Past the cutoff - the whole point of the deadline. Checked before the move
  // count so a customer inside the last 2h is told the real reason.
  if (terms.cutoffHours > 0 && h <= terms.cutoffHours) {
    return {
      ...base,
      reason: "cutoff",
      message: `Rescheduling closed ${terms.cutoffHours}h before your appointment. Please contact the studio.`,
    };
  }

  if (used >= terms.maxReschedules) {
    return {
      ...base,
      reason: "limit",
      message:
        terms.maxReschedules === 1
          ? "You've already moved this booking once, which is what your reschedule protection covers."
          : `You've used all ${terms.maxReschedules} reschedules covered by your protection.`,
    };
  }

  return {
    ...base,
    reschedulable: true,
    reason: "ok",
    message: `You're covered — move this appointment any time up to ${terms.cutoffHours}h before it starts.`,
  };
};
