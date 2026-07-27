/**
 * The bcrypt work factor, in one place.
 *
 * It was previously declared as `const BCRYPT_ROUNDS = 10` in four separate
 * services - the kind of duplication where one gets raised and the others
 * quietly don't, leaving a weaker hash on whichever path nobody thought to
 * check.
 *
 * 12 is the current OWASP guidance for bcrypt. The cost is exponential: each
 * step doubles the work, so 12 costs an attacker four times as much per guess
 * as 10 while adding roughly a couple of hundred milliseconds to a single
 * login - unnoticeable to a person, expensive at the scale offline cracking
 * operates on.
 *
 * Raising this does NOT invalidate existing passwords: bcrypt stores the cost
 * inside the hash, so old hashes keep verifying at their original factor and
 * are silently upgraded the next time that password is set.
 */
export const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS) || 12;
