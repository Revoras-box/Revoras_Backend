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
const DEFAULT_POLICY = { freeBeforeHours: 24, feePercentAfter: 50, noCancelWithinHours: 2 };

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
  const policy = { ...DEFAULT_POLICY, ...(rawPolicy || {}) };
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

  if (h <= policy.noCancelWithinHours) {
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

  if (h >= policy.freeBeforeHours) {
    return {
      cancellable: true,
      tier: "free",
      feePercent: 0,
      feeAmount: 0,
      refundAmount: payable,
      hoursUntil: h,
      policy,
      message: `Free cancellation (more than ${policy.freeBeforeHours}h before your appointment).`,
    };
  }

  // Inside the fee window: free cutoff passed, hard cutoff not yet reached.
  const feeAmount = round2((payable * policy.feePercentAfter) / 100);
  return {
    cancellable: true,
    tier: "fee",
    feePercent: policy.feePercentAfter,
    feeAmount,
    refundAmount: round2(payable - feeAmount),
    hoursUntil: h,
    policy,
    message: `A ${policy.feePercentAfter}% late-cancellation fee (₹${feeAmount}) applies within ${policy.freeBeforeHours}h of your appointment.`,
  };
};
