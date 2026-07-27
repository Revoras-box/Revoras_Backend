import crypto from "crypto";
import * as verificationRepo from "../repositories/verification.repository.js";
import { sendEmail } from "./email.service.js";
import { timingSafeEqualString } from "../utils/secureCompare.js";
import { logger } from "../utils/logger.js";

/**
 * `Math.random()` is not a CSPRNG - it is a fast PRNG seeded from process
 * state, and V8's implementation is well documented enough that observing a
 * modest run of its outputs lets you recover the internal state and predict
 * the rest. Anyone who can request codes for an address they control can
 * collect that run, then predict the code sent to somebody else's address -
 * which, since every signup path treats a verified identifier as proof of
 * ownership, is account takeover of any email or phone number.
 *
 * `crypto.randomInt` draws from the OS entropy source and is uniform over the
 * range (no modulo bias). Same six digits, no predictability.
 */
export const generateOTP = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");

// How long a signup can wait between "verified" and actually submitting the form.
const VERIFICATION_PROOF_WINDOW_MINUTES = 30;

/**
 * Guesses allowed per issued code before it is burned. Six digits is a million
 * possibilities, so a handful of tries leaves the odds of a lucky hit
 * negligible while still forgiving a genuine typo or two.
 */
const MAX_OTP_ATTEMPTS = 5;

/**
 * Codes are looked up by exact identifier match, so the identifier has to be
 * normalized identically when a code is stored and when it is checked -
 * otherwise "User@Example.com" verifies but "user@example.com" then fails to
 * find its own proof at signup. Matches user.repository's normalizeEmail.
 */
const normalizeIdentifier = (identifier) => String(identifier ?? "").trim().toLowerCase();

// Persisted (not in-memory) so verification survives a restart and works across
// multiple server instances. Invalidates any earlier unconsumed code for the same
// identifier so only the most recently sent OTP is ever valid.
export const storeOTP = async (identifier, otp) => {
  const key = normalizeIdentifier(identifier);
  await verificationRepo.invalidateUnconsumed(key);
  await verificationRepo.insertOTP(key, otp);
};

export const verifyOTP = async (identifier, otp) => {
  const record = await verificationRepo.findLatestUnconsumed(normalizeIdentifier(identifier));
  if (!record || new Date(record.expires_at) < new Date()) {
    return { valid: false, error: "OTP expired or not found" };
  }

  // Checked before comparing, so a code that has already been guessed at too
  // many times can't be revived by racing several requests at it.
  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await verificationRepo.consumeById(record.id);
    return { valid: false, error: "Too many incorrect attempts. Please request a new code." };
  }

  if (!timingSafeEqualString(String(record.otp), String(otp ?? ""))) {
    const attempts = await verificationRepo.recordFailedAttempt(record.id);
    if (attempts >= MAX_OTP_ATTEMPTS) {
      await verificationRepo.consumeById(record.id);
      return { valid: false, error: "Too many incorrect attempts. Please request a new code." };
    }
    return { valid: false, error: "Invalid OTP" };
  }

  await verificationRepo.markVerified(record.id);
  return { valid: true };
};

/**
 * Server-side check that `identifier` (an email or phone) actually completed OTP
 * verification recently. Signup endpoints call this instead of trusting a
 * client-supplied emailVerified/phoneVerified boolean. Single-use: the matching
 * row is marked consumed so it can't back a second signup.
 */
export const consumeVerificationProof = async (identifier) => {
  if (!identifier) return false;
  return verificationRepo.consumeIfProven(normalizeIdentifier(identifier), VERIFICATION_PROOF_WINDOW_MINUTES);
};

/**
 * Whether this server may hand a freshly-issued code back to whoever asked for
 * it, instead of only delivering it out-of-band.
 *
 * That behaviour is essential locally (there is no mail server, and no SMS
 * provider at all) and a complete bypass of verification anywhere real: the
 * caller is told the secret that was supposed to prove they control the
 * address. It used to be inferred from `NODE_ENV !== "production"`, which
 * makes one unset environment variable - the single easiest deployment
 * mistake there is - silently disable email and phone verification.
 *
 * So it is now an explicit opt-in that has to be set on purpose, and is
 * ignored outright when NODE_ENV=production. Nothing about forgetting to
 * configure something can turn it on.
 */
export const canEchoOtpToCaller = () =>
  process.env.NODE_ENV !== "production" && String(process.env.AUTH_DEV_ECHO_OTP).toLowerCase() === "true";

export const sendEmailOTP = async (email, otp) => {
  const result = await sendEmail({
    to: email,
    subject: "Revoras - Email Verification Code",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
        <div style="max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px;">
          <h2 style="color: #C8A96E; text-align: center;">Revaros</h2>
          <p style="color: #333; font-size: 16px;">Your verification code is:</p>
          <div style="background: #050505; color: #C8A96E; font-size: 32px; text-align: center;
                      padding: 20px; border-radius: 8px; letter-spacing: 8px; margin: 20px 0;">
            ${otp}
          </div>
          <p style="color: #666; font-size: 12px; text-align: center;">
            This code expires in 5 minutes. Do not share this code with anyone.
          </p>
        </div>
      </div>
    `,
  });

  if (!result.success) {
    logger.error("Email OTP send failed", { error: result.error });
    return result;
  }

  if (result.dev && canEchoOtpToCaller()) {
    logger.debug(`[DEV] Email OTP for ${email}: ${otp}`);
  }

  return result;
};

/**
 * There is no SMS provider wired up yet - this has always been a stub.
 *
 * The stub used to return `{ success: true, dev: true }` unconditionally,
 * which the controller took as licence to return the code in the HTTP
 * response. In every environment, including production: no SMS was ever sent,
 * and the endpoint simply told the caller what the code was. Since business
 * and host registration both require a verified phone number, that made phone
 * verification a formality anyone could complete against any number.
 *
 * Now it fails closed. Without a real provider, production gets an honest
 * failure the caller can see, rather than a verification step that quietly
 * verifies nothing.
 */
export const sendPhoneOTP = async (phone, otp) => {
  if (process.env.NODE_ENV === "production") {
    logger.error("Phone OTP requested but no SMS provider is configured - refusing to fake a successful send");
    return { success: false, error: "SMS delivery is not configured on this server" };
  }

  if (canEchoOtpToCaller()) {
    logger.debug(`[DEV] Phone OTP for ${phone}: ${otp}`);
    return { success: true, dev: true };
  }

  logger.warn(
    "Phone OTP requested but no SMS provider is configured. Set AUTH_DEV_ECHO_OTP=true to receive codes " +
      "in the API response for local development."
  );
  return { success: false, error: "SMS delivery is not configured on this server" };
};
