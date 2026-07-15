import Razorpay from "razorpay";

// Test-mode keys are enough to run the full flow; without any keys at all we
// export null and the payment controller returns a clear 503 instead of crashing
// the whole server on boot (this backend has no other reason to require Razorpay
// to be configured just to start up).
export const razorpay =
  process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
    ? new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET,
      })
    : null;

export const isRazorpayConfigured = () => razorpay !== null;
