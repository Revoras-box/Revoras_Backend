const RESEND_API_URL = "https://api.resend.com/emails";

export const sendEmail = async ({ to, subject, html }) => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "production") {
      return {
        success: false,
        error: "Missing RESEND_API_KEY or EMAIL_FROM",
      };
    }

    console.log(`[DEV MODE] Email to ${to}: ${subject}`);
    return { success: true, dev: true };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return {
        success: false,
        error: payload?.message || `Resend API error (${response.status})`,
      };
    }

    return { success: true, id: payload?.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
