import pool from "../config/db.js";
import {
  generateOTP,
  storeOTP,
  verifyOTP,
  sendEmailOTP,
  sendPhoneOTP,
} from "../services/verification.service.js";

export const sendVerificationCode = async (req, res) => {
  try {
    const { email, phone, type } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ error: "Email or phone required" });
    }

    const existing = await pool.query(
      "SELECT id FROM barbers WHERE email = $1 OR phone = $2",
      [email || "", phone || ""]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Email or phone already registered" });
    }

    const otp = generateOTP();

    if (type === "email" && email) {
      storeOTP(email, phone || "", otp);
      const result = await sendEmailOTP(email, otp);
      return res.json({ 
        message: "Verification code sent to email",
        dev: result.dev || false,
        otp: result.dev ? otp : undefined
      });
    }

    if (type === "phone" && phone) {
      storeOTP(phone, email || "", otp);
      const result = await sendPhoneOTP(phone, otp);
      return res.json({ 
        message: "Verification code sent to phone",
        dev: result.dev || false,
        otp: result.dev ? otp : undefined
      });
    }

    const emailOtp = generateOTP();
    const phoneOtp = generateOTP();
    
    storeOTP(email, phone, emailOtp);
    storeOTP(phone, email, phoneOtp);

    const emailResult = await sendEmailOTP(email, emailOtp);
    const phoneResult = await sendPhoneOTP(phone, phoneOtp);

    res.json({
      message: "Verification codes sent",
      dev: emailResult.dev || phoneResult.dev || false,
      emailOtp: emailResult.dev ? emailOtp : undefined,
      phoneOtp: phoneResult.dev ? phoneOtp : undefined,
    });
  } catch (error) {
    console.error("Send verification error:", error);
    res.status(500).json({ error: "Failed to send verification code" });
  }
};

export const verifyCode = async (req, res) => {
  try {
    const { email, phone, otp, type } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ error: "Email or phone required" });
    }

    const key = type === "phone" ? phone : email;
    const result = verifyOTP(key, otp);

    if (!result.valid) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ message: "Verification successful", verified: true });
  } catch (error) {
    console.error("Verify code error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
};
