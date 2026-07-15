import bcrypt from "bcrypt";
import crypto from "crypto";
import * as userRepo from "../repositories/user.repository.js";
import * as passwordResetRepo from "../repositories/passwordReset.repository.js";
import { sendEmail } from "./email.service.js";
import { ServiceError } from "../utils/ServiceError.js";

const BCRYPT_ROUNDS = 10;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MINUTES = 60;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/**
 * Replaces the old in-memory Map of reset tokens (didn't survive a restart,
 * per-instance only). The token itself is only ever a bearer secret in the
 * email link - the DB stores just its SHA-256 hash, so a DB read alone can't
 * produce a working reset link.
 */
export const requestPasswordReset = async (email) => {
  const user = await userRepo.findByEmail(email);
  // Silently no-op if the account doesn't exist - the controller always
  // returns the same generic message either way, so this can't be used to
  // enumerate registered emails.
  if (!user) return;

  await passwordResetRepo.invalidateForUser(user.id);

  const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString("hex");

  await passwordResetRepo.create({
    user_id: user.id,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000),
  });

  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

  const sendResult = await sendEmail({
    to: email,
    subject: "Revoras - Password Reset",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; background-color: #f5f5f5;">
        <div style="max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px;">
          <h2 style="color: #C8A96E; text-align: center;">Revoras</h2>
          <p style="color: #333; font-size: 16px;">Hi ${user.name || "there"},</p>
          <p style="color: #333; font-size: 14px;">You requested a password reset. Click the button below to set a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #C8A96E; color: black; padding: 12px 30px; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 12px; text-align: center;">
            This link expires in ${RESET_TOKEN_TTL_MINUTES} minutes. If you didn't request this, please ignore this email.
          </p>
        </div>
      </div>
    `,
  });

  if (!sendResult.success) {
    throw new ServiceError(502, "Failed to send reset email");
  }

  if (sendResult.dev) {
    console.log(`[DEV] Password reset link for ${email}: ${resetUrl}`);
  }
};

export const resetPassword = async (token, newPassword) => {
  const record = await passwordResetRepo.findValidByHash(hashToken(token));
  if (!record) throw new ServiceError(400, "Invalid or expired reset token");

  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  // Also bumps token_version - revokes every session that existed before
  // this reset, not just the ones an attacker might have (report.md Phase
  // 2.3 plan's revocation approach).
  await userRepo.updatePassword(record.user_id, hashed);
  await passwordResetRepo.consume(record.id);
};
