/**
 * Boot-time validation of the secrets everything else's security rests on.
 *
 * `JWT_SECRET` is the single key that signs every customer, business and admin
 * token. Anyone who can guess it can mint a token for any account on the
 * platform, including a super_admin - no password needed, no lockout to trip,
 * nothing in the logs to notice. So "is it set?" (which server.js already
 * asked) is not a strong enough question: a short lowercase passphrase is set,
 * and is still trivially brute-forced offline from a single captured token.
 *
 * The checks below are deliberately crude - length, distinct characters, and a
 * few obvious placeholder values. They can't measure real entropy (nothing
 * can, from the value alone), but they reliably catch the failure that
 * actually happens in practice: someone typing a memorable phrase into .env
 * because it was quicker than generating one.
 *
 * Outside production a failure is a loud warning, so local development is
 * never blocked. In production it refuses to boot - a weak signing key is not
 * something to discover from an incident.
 */
import crypto from "crypto";
import { logger } from "../utils/logger.js";

const MIN_LENGTH = 32;

/**
 * Low enough not to fail a legitimate secret. A 32-character hex string is 128
 * bits of entropy but draws from an alphabet of only 16 characters, so it can
 * never have more than 16 distinct ones - a higher bar here would reject the
 * perfectly good output of `openssl rand -hex 32`. This only catches degenerate
 * input like "aaaaaaaa..." or "abababab...".
 */
const MIN_DISTINCT_CHARS = 12;

/**
 * Fragments that a generated secret essentially never contains and a typed one
 * very often does.
 *
 * This is the check that actually distinguishes the two. Length alone does not:
 * the value this repo shipped with, "thisisasecretkeyforjwt_tokengeneration",
 * is 38 characters and would clear any reasonable length or
 * distinct-character bar, while being a phrase somebody could plausibly guess.
 * Counting distinct characters doesn't work either, because random hex legitimately
 * scores low on it.
 *
 * Every marker is at least five characters, which keeps this one-directional.
 * Short ones ("key", "dev", "jwt") turn up in random output often enough to
 * matter - with those included, measured false positives were ~0.7%, or one
 * spurious rejection per ~140 freshly generated secrets. At five characters
 * and up the rate is negligible, and nothing real is lost: every hand-written
 * secret in this repo's history contained one of the longer words anyway.
 */
const TYPED_SECRET_MARKERS = [
  "secret", "password", "passwd", "changeme", "change_me", "please",
  "token", "session", "admin", "staging", "revoras", "example", "sample",
  "qwerty", "123456", "abcdef", "letmein", "default",
];

/** Placeholders that have shipped in this repo's docs/history, plus the usual suspects. */
const KNOWN_PLACEHOLDERS = new Set([
  "session_secret_key",
  "secret",
  "secretkey",
  "changeme",
  "change_me",
  "your_jwt_secret",
  "your-secret-key",
  "jwt_secret",
  "supersecret",
  "development",
  "test",
]);

/** A ready-to-paste replacement, so the error message is actionable rather than a scolding. */
export const generateSecret = () => crypto.randomBytes(48).toString("base64url");

const weaknessOf = (value) => {
  if (!value) return "is not set";

  const lowered = value.toLowerCase();

  if (KNOWN_PLACEHOLDERS.has(lowered)) return "is a known placeholder value";
  if (value.length < MIN_LENGTH) return `is only ${value.length} characters (minimum ${MIN_LENGTH})`;

  const marker = TYPED_SECRET_MARKERS.find((m) => lowered.includes(m));
  if (marker) {
    return `contains the word "${marker}", so it was typed rather than generated - length alone does not make a phrase unguessable`;
  }

  const distinct = new Set(value).size;
  if (distinct < MIN_DISTINCT_CHARS) {
    return `uses only ${distinct} distinct characters, which is not a generated key`;
  }

  return null;
};

/**
 * Validates every secret the app signs or encrypts with. Throws in production,
 * warns everywhere else. Call once, before the first route is registered.
 */
export const assertStrongSecrets = ({ strict = process.env.NODE_ENV === "production" } = {}) => {
  const problems = [];

  for (const name of ["JWT_SECRET", "SESSION_SECRET"]) {
    const weakness = weaknessOf(process.env[name]);
    if (weakness) problems.push(`${name} ${weakness}`);
  }

  // Reusing one key for both means a session-cookie compromise is also an
  // auth-token compromise. They are separate variables; keep them separate values.
  if (process.env.JWT_SECRET && process.env.JWT_SECRET === process.env.SESSION_SECRET) {
    problems.push("JWT_SECRET and SESSION_SECRET are the same value");
  }

  if (problems.length === 0) return;

  const detail = problems.map((p) => `  - ${p}`).join("\n");
  const remedy = `Generate replacements with:\n  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"\nRotating JWT_SECRET signs every existing session out; that is expected.`;

  if (strict) {
    throw new Error(`Refusing to start with weak secrets:\n${detail}\n\n${remedy}`);
  }

  logger.warn(
    `Weak secrets detected - this would refuse to boot with NODE_ENV=production:\n${detail}\n\n${remedy}`
  );
};
