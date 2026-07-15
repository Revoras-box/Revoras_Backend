import * as passwordService from "../services/password.service.js";
import { forgotPasswordSchema, resetPasswordSchema } from "../validators/password.validator.js";

// POST /api/password/forgot-password
export const forgotPassword = async (req, res) => {
  const { email } = forgotPasswordSchema.parse(req.body);
  await passwordService.requestPasswordReset(email);
  // Same generic message whether or not the account exists - don't leak
  // which emails are registered.
  res.json({ message: "If an account exists, a reset link has been sent" });
};

// POST /api/password/reset-password
export const resetPassword = async (req, res) => {
  const { token, newPassword } = resetPasswordSchema.parse(req.body);
  await passwordService.resetPassword(token, newPassword);
  res.json({ message: "Password has been reset successfully" });
};
