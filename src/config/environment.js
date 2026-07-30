/**
 * Which environment this process believes it is running in - stated, not guessed.
 *
 * Every safety guard in this codebase is written as `NODE_ENV === "production"`
 * or its negation: whether mock payments are allowed to confirm bookings for
 * free (config/payments.js), whether signup OTPs are echoed back in the API
 * response (services/verification.service.js), whether weak secrets refuse the
 * boot or merely warn (config/secrets.js), whether emails are actually sent
 * (services/email.service.js), whether the session cookie is Secure, and what
 * the log level defaults to.
 *
 * All of which means the entire fail-closed design rests on one variable - and
 * that variable was not in `.env` at all. Each of those guards asks whether
 * NODE_ENV *equals* "production", so an unset value is treated as development
 * and every one of them silently opens.
 *
 * config/payments.js already worried about the right scenario: a working
 * development `.env` copied onto a server, carrying `PAYMENTS_MODE=mock` with
 * it. But the guard it wrote catches `mock` + `NODE_ENV=production`, and the
 * likelier accident is `mock` + NODE_ENV *absent* - likelier precisely because
 * the file never mentioned NODE_ENV, so there was nothing to remember to
 * change. That deployment takes no money, echoes verification codes to anyone
 * who asks, and sends no email, with no error anywhere to say so.
 *
 * The fix is to stop inferring. An environment must be declared, and the
 * declaration must be one this code recognises - a typo like "prod" or
 * "Production" is not production to a `===` comparison, and would fail open in
 * exactly the same way. After this runs, every `!== "production"` test in the
 * codebase is trustworthy, because the only alternatives are the two names
 * below.
 */
const KNOWN_ENVIRONMENTS = ["development", "test", "production"];

export const assertEnvironmentDeclared = () => {
  const declared = process.env.NODE_ENV;

  if (!declared) {
    throw new Error(
      "Refusing to start: NODE_ENV is not set.\n\n" +
        "This app decides whether to take real payments, whether to echo signup OTPs in API " +
        "responses, and whether weak secrets are fatal, all from NODE_ENV. An unset value reads " +
        "as development everywhere, so a deployment that omits it runs wide open and silently.\n\n" +
        `Set NODE_ENV to one of: ${KNOWN_ENVIRONMENTS.join(", ")}.`
    );
  }

  if (!KNOWN_ENVIRONMENTS.includes(declared)) {
    throw new Error(
      `Refusing to start: NODE_ENV="${declared}" is not a recognised environment.\n\n` +
        "Every guard in this codebase compares NODE_ENV against \"production\" exactly, so a near " +
        "miss (\"prod\", \"Production\", \"staging\") is treated as development and disables those " +
        "guards without warning.\n\n" +
        `Set NODE_ENV to one of: ${KNOWN_ENVIRONMENTS.join(", ")}.`
    );
  }
};

export const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Say out loud, at every boot, which security controls are currently switched off.
 *
 * The check above closes the case where a deployment sets no environment at all.
 * It deliberately does not close the other one: `.env` now carries
 * `NODE_ENV=development`, so a wholesale copy of a working developer's file onto
 * a server boots happily in development mode. That is not fixable by validation
 * - the file is internally consistent and says exactly what it means. dotenv
 * does not overwrite variables that already exist, so the real defence there is
 * setting NODE_ENV=production in the orchestrator (Dockerfile/Jenkinsfile),
 * where it wins over the copied file and `assertPaymentModeIsSafe` then refuses
 * the boot.
 *
 * What is fixable is the silence. Each of these switches is individually
 * documented and individually sensible; what makes them dangerous is that a
 * server running with all of them on looks, from the outside, exactly like a
 * healthy one - bookings confirm, signups succeed, nothing errors. The only
 * symptom is revenue that never arrives.
 *
 * So this prints them at `warn`, unconditionally, in whatever environment. It
 * cannot stop a misconfigured deploy, but it means the evidence is sitting at
 * the top of the logs the first time anybody goes looking, rather than having to
 * be deduced from missing money.
 */
export const reportDisabledSecurityControls = (logger) => {
  const disabled = [];

  if (String(process.env.PAYMENTS_MODE || "").trim().toLowerCase() === "mock") {
    disabled.push("PAYMENTS_MODE=mock - bookings are confirmed WITHOUT taking any payment");
  }
  if (!isProduction() && String(process.env.AUTH_DEV_ECHO_OTP).toLowerCase() === "true") {
    disabled.push("AUTH_DEV_ECHO_OTP=true - signup OTPs are returned in API responses, so email/phone verification is not a control");
  }
  if (String(process.env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION).toLowerCase() === "true") {
    disabled.push("ALLOW_MOCK_PAYMENTS_IN_PRODUCTION=true - the production mock-payment refusal is overridden");
  }
  if (!isProduction() && !process.env.RESEND_API_KEY) {
    disabled.push("RESEND_API_KEY unset - email is logged to the console, not delivered");
  }
  if (!(Number(process.env.TRUST_PROXY) > 0)) {
    disabled.push("TRUST_PROXY=0 - correct only if nothing proxies this app; behind one, per-IP rate limiting does not work");
  }

  if (disabled.length === 0) return;

  logger.warn(
    `Security controls disabled in this environment (NODE_ENV=${process.env.NODE_ENV}):\n` +
      disabled.map((line) => `  - ${line}`).join("\n"),
    { environment: process.env.NODE_ENV, disabledCount: disabled.length }
  );
};
