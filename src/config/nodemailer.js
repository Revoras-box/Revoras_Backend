import { sendEmail } from "../services/email.service.js";

const transporter = {
  sendMail: async ({ to, subject, html }) => sendEmail({ to, subject, html }),
};

export default transporter;
