import * as stateMachine from "./bookingStateMachine.js";

/**
 * Phase 2.5 (Booking Experience) - the cancellation policy engine (decision
 * D3). One place that turns a business's structured policy + how long until the
 * appointment into a customer-facing outcome:
 *   - Free            (outside the free-cancellation window)
 *   - X% fee          (inside the fee window but before the hard cutoff)
 *   - Not cancellable  (past the no-cancel cutoff, or already terminal)
 *
 * Computes and RETURNS the fee; it does not issue a refund/charge - that's a
 * later payments slice. Both the cancel action and the preview endpoint call
 * this, so what the customer is shown is what gets recorded.
 */
// The refund schedule an owner configures in onboarding (Business information):
// cancel at least `hoursBefore` ahead of the appointment → get `refundPercent`
// back. A customer earns the highest tier they clear. `noCancelWithinHours` is
// the hard cutoff after which nothing can be cancelled. This is the default a
// business inherits until it saves its own.
const DEFAULT_TIERS = [
  { hoursBefore: 72, refundPercent: 100 }, // 3 days
  { hoursBefore: 48, refundPercent: 75 }, //  2 days
  { hoursBefore: 24, refundPercent: 50 },
  { hoursBefore: 12, refundPercent: 25 },
  { hoursBefore: 6, refundPercent: 0 },
];
const DEFAULT_POLICY = { tiers: DEFAULT_TIERS, noCancelWithinHours: 2 };

const clampPercent = (n) => Math.min(100, Math.max(0, n));

/**
 * Accept both the current tiered shape and the legacy single-tier one
 * (`{ freeBeforeHours, feePercentAfter, noCancelWithinHours }`) that rows
 * written before the tier model still hold, and return a normalized
 * `{ tiers[], noCancelWithinHours }` sorted by `hoursBefore` descending so the
 * evaluator can just take the first tier the customer clears.
 */
const normalizePolicy = (rawPolicy) => {
  const p = rawPolicy || {};
  const noCancelWithinHours = Number.isFinite(p.noCancelWithinHours)
    ? p.noCancelWithinHours
    : DEFAULT_POLICY.noCancelWithinHours;

  let tiers;
  if (Array.isArray(p.tiers) && p.tiers.length) {
    tiers = p.tiers
      .map((t) => ({ hoursBefore: Number(t.hoursBefore), refundPercent: clampPercent(Number(t.refundPercent)) }))
      .filter((t) => Number.isFinite(t.hoursBefore) && Number.isFinite(t.refundPercent));
  } else if (Number.isFinite(p.freeBeforeHours) || Number.isFinite(p.feePercentAfter)) {
    // Legacy: free before X hours (full refund), a single fee % in the window
    // between the hard cutoff and X. Expressed as two tiers, this reproduces the
    // old outcomes exactly.
    const freeBeforeHours = Number.isFinite(p.freeBeforeHours) ? p.freeBeforeHours : 24;
    const feePercentAfter = Number.isFinite(p.feePercentAfter) ? p.feePercentAfter : 50;
    tiers = [
      { hoursBefore: freeBeforeHours, refundPercent: 100 },
      { hoursBefore: Math.max(noCancelWithinHours, 0), refundPercent: clampPercent(100 - feePercentAfter) },
    ];
  } else {
    tiers = DEFAULT_POLICY.tiers.map((t) => ({ ...t }));
  }

  tiers.sort((a, b) => b.hoursBefore - a.hoursBefore);

  // Backward-compatible single-tier summary for consumers that predate the tier
  // model (the customer confirmation page renders "Free until X, then Y% fee").
  // freeBeforeHours = the tightest window that still refunds in full; the fee
  // "after free" is whatever the next tier down charges.
  const fullTiers = tiers.filter((t) => t.refundPercent >= 100);
  const freeBeforeHours = fullTiers.length ? Math.min(...fullTiers.map((t) => t.hoursBefore)) : tiers[0]?.hoursBefore ?? 0;
  const belowFree = tiers.find((t) => t.hoursBefore < freeBeforeHours);
  const feePercentAfter = belowFree ? clampPercent(100 - belowFree.refundPercent) : 100;

  return { tiers, noCancelWithinHours, freeBeforeHours, feePercentAfter };
};

/**
 * The appointment as a real Date. `booking.booking_date` comes back from the
 * driver as a Date (Postgres `date` → local-midnight Date), so the naive
 * `` `${booking.booking_date}T${start_time}` `` template produces "Invalid
 * Date" → NaN. (That's a pre-existing bug: the old hardcoded 2h cutoff used the
 * same template, so `NaN < 2` was always false and the cutoff never actually
 * blocked anything.) Rebuild from local calendar components + start_time as
 * local wall-clock, matching how createBooking constructs appointment times.
 */
const appointmentDate = (booking) => {
  const d = booking.booking_date instanceof Date ? booking.booking_date : new Date(booking.booking_date);
  const [hh = 0, mm = 0] = String(booking.start_time).split(":").map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hh, mm, 0, 0);
};

const hoursUntil = (booking, now) => (appointmentDate(booking).getTime() - now.getTime()) / (1000 * 60 * 60);

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * @returns {{ cancellable: boolean, tier: "free"|"fee"|"blocked"|"terminal",
 *   feePercent: number, feeAmount: number, refundAmount: number, hoursUntil: number,
 *   policy: object, message: string }}
 */
export const evaluate = (booking, rawPolicy, now = new Date()) => {
  const policy = normalizePolicy(rawPolicy);
  const payable = Number(booking.total_amount) || 0;

  // A booking the state machine won't let cancel (completed/cancelled/no_show)
  // is never cancellable, regardless of timing.
  if (!stateMachine.canTransition(booking.status, "cancelled")) {
    return {
      cancellable: false,
      tier: "terminal",
      feePercent: 0,
      feeAmount: 0,
      refundAmount: 0,
      hoursUntil: 0,
      policy,
      message: `This booking is ${booking.status} and can't be cancelled.`,
    };
  }

  const h = hoursUntil(booking, now);

  if (policy.noCancelWithinHours > 0 && h <= policy.noCancelWithinHours) {
    return {
      cancellable: false,
      tier: "blocked",
      feePercent: 0,
      feeAmount: 0,
      refundAmount: 0,
      hoursUntil: h,
      policy,
      message: `Cancellations aren't allowed within ${policy.noCancelWithinHours}h of the appointment. Please contact the studio.`,
    };
  }

  // Highest tier the customer clears (tiers are sorted by hoursBefore desc). If
  // they're inside even the tightest window, no tier matches → no refund.
  const matched = policy.tiers.find((t) => h >= t.hoursBefore);
  const refundPercent = matched ? matched.refundPercent : 0;
  const feePercent = clampPercent(100 - refundPercent);
  const feeAmount = round2((payable * feePercent) / 100);
  const refundAmount = round2(payable - feeAmount);

  if (refundPercent >= 100) {
    return {
      cancellable: true,
      tier: "free",
      feePercent: 0,
      feeAmount: 0,
      refundAmount: payable,
      hoursUntil: h,
      policy,
      message: `Free cancellation — you'll be refunded in full.`,
    };
  }

  return {
    cancellable: true,
    tier: "fee",
    feePercent,
    feeAmount,
    refundAmount,
    hoursUntil: h,
    policy,
    message:
      refundPercent > 0
        ? `${refundPercent}% refund (₹${refundAmount}) at this notice — a ${feePercent}% cancellation fee (₹${feeAmount}) applies.`
        : `No refund at this notice — a ${feePercent}% cancellation fee (₹${feeAmount}) applies.`,
  };
};
