import * as verificationRepo from "../repositories/verification.repository.js";
import { sendEmail } from "./email.service.js";

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// How long a signup can wait between "verified" and actually submitting the form.
const VERIFICATION_PROOF_WINDOW_MINUTES = 30;

// Persisted (not in-memory) so verification survives a restart and works across
// multiple server instances. Invalidates any earlier unconsumed code for the same
// identifier so only the most recently sent OTP is ever valid.
export const storeOTP = async (identifier, otp) => {
  await verificationRepo.invalidateUnconsumed(identifier);
  await verificationRepo.insertOTP(identifier, otp);
};

export const verifyOTP = async (identifier, otp) => {
  const record = await verificationRepo.findLatestUnconsumed(identifier);
  if (!record || new Date(record.expires_at) < new Date()) {
    return { valid: false, error: "OTP expired or not found" };
  }
  if (record.otp !== otp) {
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
  return verificationRepo.consumeIfProven(identifier, VERIFICATION_PROOF_WINDOW_MINUTES);
};

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
    console.error("Email send error:", result.error);
    return result;
  }

  if (result.dev) {
    console.log(`[DEV MODE] Email OTP for ${email}: ${otp}`);
  }

  return result;
};

export const sendPhoneOTP = async (phone, otp) => {
  console.log(`[DEV MODE] Phone OTP for ${phone}: ${otp}`);
  return { success: true, dev: true };
};
