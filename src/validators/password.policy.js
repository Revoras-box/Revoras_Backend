import { z } from "zod";

/**
 * One password policy, shared by every place a password is set: customer
 * signup, business/host signup, password reset, change-password, and admin
 * creation. Previously each of those declared its own `z.string().min(6)`,
 * which is both weaker than it looks and free to drift apart.
 *
 * The rules are deliberately close to NIST SP 800-63B: length is what actually
 * matters, and arbitrary composition rules ("must contain a symbol") mostly
 * push people toward `Password1!` while blocking genuinely strong
 * passphrases. So this enforces a real minimum length and screens the handful
 * of passwords that appear at the top of every breach corpus - it does not
 * demand a character zoo.
 *
 * The 72-byte ceiling is not arbitrary either: bcrypt silently truncates
 * beyond 72 *bytes*, so anything longer gives a false sense of strength and
 * makes two different long passwords hash identically. Measured in bytes
 * rather than characters because non-ASCII (accents, emoji) costs several
 * bytes each.
 */

const MIN_LENGTH = 8;
const MAX_BYTES = 72;

/**
 * The passwords that turn up first in any credential-stuffing list. Not a
 * substitute for a real breach-corpus check (that wants an external dataset -
 * Have I Been Pwned's k-anonymity range API is the usual choice); this is the
 * cheap screen that catches the worst of it with no dependency.
 */
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789",
  "1234567890", "qwertyui", "qwerty123", "iloveyou", "adminadmin", "administrator",
  "welcome1", "welcome123", "letmein1", "letmein123", "abc12345", "11111111",
  "00000000", "football", "baseball", "sunshine", "princess", "dragon123",
  "monkey123", "trustno1", "changeme", "secret123", "revoras123",
]);

export const passwordField = z
  .string()
  .min(MIN_LENGTH, `Password must be at least ${MIN_LENGTH} characters`)
  .refine((v) => Buffer.byteLength(v, "utf8") <= MAX_BYTES, {
    message: `Password must be at most ${MAX_BYTES} bytes (bcrypt ignores anything beyond that)`,
  })
  .refine((v) => !COMMON_PASSWORDS.has(v.toLowerCase()), {
    message: "That password is among the most commonly used ones. Please choose something less predictable.",
  })
  .refine((v) => new Set(v.toLowerCase()).size > 2, {
    // "aaaaaaaa" / "abababab" clear the length bar while carrying almost no entropy.
    message: "Password is too repetitive. Please choose something less predictable.",
  });

/**
 * For LOGIN only - checks that something was typed, nothing more. Applying the
 * policy here would reject the existing passwords of everyone who signed up
 * under the old 6-character rule, and would leak which passwords could
 * possibly be valid.
 */
export const anyPasswordField = z.string().min(1);
