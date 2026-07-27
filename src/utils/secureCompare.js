import crypto from "crypto";

/**
 * Constant-time string equality, for comparing anything an attacker supplies
 * against a secret we computed: HMAC signatures, OTPs, bearer tokens.
 *
 * `a === b` on strings short-circuits at the first differing byte, so how long
 * the comparison takes leaks how many leading bytes were right. That is enough
 * to recover a signature one byte at a time given enough attempts, without
 * ever needing the key. Over a network the signal is noisy and this attack is
 * rarely the easy way in - but the fix costs one function call, so there is no
 * reason to leave the oracle in place.
 *
 * `crypto.timingSafeEqual` throws on length mismatch (a leak in itself), so
 * both sides are hashed to a fixed 32 bytes first. Comparing digests is
 * equivalent to comparing the inputs, and makes length differences free.
 */
export const timingSafeEqualString = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string") return false;

  const digest = (value) => crypto.createHash("sha256").update(value, "utf8").digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
};
