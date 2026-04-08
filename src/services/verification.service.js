import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

export const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

const otpStore = new Map();

export const storeOTP = (email, phone, otp) => {
  otpStore.set(email, { otp, phone, createdAt: Date.now(), type: "email" });
  otpStore.set(phone, { otp, email, createdAt: Date.now(), type: "phone" });
};

export const getOTP = (key) => {
  const data = otpStore.get(key);
  if (!data) return null;
  
  const fiveMinutes = 5 * 60 * 1000;
  if (Date.now() - data.createdAt > fiveMinutes) {
    otpStore.delete(key);
    return null;
  }
  
  return data.otp;
};

export const verifyOTP = (key, otp) => {
  const stored = getOTP(key);
  if (!stored) return { valid: false, error: "OTP expired or not found" };
  if (stored !== otp) return { valid: false, error: "Invalid OTP" };
  
  otpStore.delete(key);
  return { valid: true };
};

export const sendEmailOTP = async (email, otp) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`[DEV MODE] Email OTP for ${email}: ${otp}`);
    return { success: true, dev: true };
  }

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
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
    return { success: true };
  } catch (error) {
    console.error("Email send error:", error);
    return { success: false, error: error.message };
  }
};

export const sendPhoneOTP = async (phone, otp) => {
  console.log(`[DEV MODE] Phone OTP for ${phone}: ${otp}`);
  return { success: true, dev: true };
};
