import { isRazorpayConfigured } from "./razorpay.js";

/**
 * Which payment path this server offers.
 *
 * "mock" is a TEMPORARY development stand-in: the customer clicks Pay and the
 * booking is confirmed immediately, with a payment row written as paid but no
 * money moved. It exists so the rest of the funnel (slot held, slot shows as
 * booked, confirmation, bookings list) can be built and demoed without live
 * Razorpay credentials - this server currently has none.
 *
 * Two guards, because "no money moved" must never be true silently in
 * production:
 *  - PAYMENTS_MODE is the explicit switch; anything other than "mock" means
 *    the real gateway.
 *  - Without the switch, mock is only inferred when Razorpay is unconfigured
 *    AND this isn't production. A production server with no keys returns the
 *    honest 503 it always did rather than quietly confirming free bookings.
 */
export const isMockPaymentMode = () => {
  const explicit = String(process.env.PAYMENTS_MODE || "").trim().toLowerCase();
  if (explicit === "mock") return true;
  if (explicit === "razorpay" || explicit === "live") return false;
  return !isRazorpayConfigured() && process.env.NODE_ENV !== "production";
};

export const paymentMode = () => (isMockPaymentMode() ? "mock" : "razorpay");

/**
 * Boot-time refusal, called from server.js.
 *
 * The NODE_ENV guard above only covers the *inferred* case - it stops a
 * production server with no Razorpay keys from quietly confirming free
 * bookings. It does nothing about an explicit `PAYMENTS_MODE=mock`, which is
 * precisely the value most likely to survive a copy of a working development
 * .env into a production deployment. That combination means every customer
 * gets a confirmed booking for free, silently, and the only symptom is
 * revenue that never arrives.
 *
 * A .env is much easier to get wrong than to deliberately override, so this
 * fails loudly at boot rather than per request. Genuinely wanting mock
 * payments in a production-flagged environment (a staging server, a demo)
 * means setting ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true as a second,
 * unmistakably deliberate act.
 */
export const assertPaymentModeIsSafe = () => {
  if (process.env.NODE_ENV !== "production") return;
  if (!isMockPaymentMode()) return;
  if (String(process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION).toLowerCase() === "true") return;

  throw new Error(
    "Refusing to start: PAYMENTS_MODE=mock with NODE_ENV=production would confirm every booking " +
      "without taking payment. Set PAYMENTS_MODE=razorpay and provide real Razorpay keys, or set " +
      "ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true if this is a deliberately non-charging environment."
  );
};
