import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import pool from "../config/db.js";
import { sendEmail } from "../services/email.service.js";

const resetTokenStore = new Map();

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const result = await pool.query(
      "SELECT id, name FROM users WHERE email = $1",
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ message: "If an account exists, a reset link has been sent" });
    }

    const user = result.rows[0];
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + 60 * 60 * 1000;

    resetTokenStore.set(token, { userId: user.id, email, expiresAt });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

    const mailOptions = {
      to: email,
      subject: "SnapCut - Password Reset",
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
              This link expires in 1 hour. If you didn't request this, please ignore this email.
            </p>
          </div>
        </div>
      `,
    };

    const sendResult = await sendEmail(mailOptions);
    if (!sendResult.success) {
      console.error("Password reset email send error:", sendResult.error);
      return res.status(502).json({ error: "Failed to send reset email" });
    }

    if (sendResult.dev) {
      console.log(`[DEV] Password reset link for ${email}: ${resetUrl}`);
    }

    res.json({ message: "If an account exists, a reset link has been sent" });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const tokenData = resetTokenStore.get(token);

    if (!tokenData) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    if (Date.now() > tokenData.expiresAt) {
      resetTokenStore.delete(token);
      return res.status(400).json({ error: "Reset token has expired" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(
      "UPDATE users SET password = $1 WHERE id = $2",
      [hashedPassword, tokenData.userId]
    );

    resetTokenStore.delete(token);

    res.json({ message: "Password has been reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
};
