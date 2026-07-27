import knex from "../../db/knex.js";

/**
 * Mechanical Knex port of the queries verification.service.js used to run
 * directly against the raw pg pool - report.md Phase 2.3 plan's "repositories
 * own all queries" rule, extracted now rather than at Phase 1 since this file
 * was reviewed and judged "genuinely solid, don't touch without reason" back
 * then. Same SQL, same security properties (single-use, time-boxed), just
 * behind a repository instead of inline in the service.
 */

export const invalidateUnconsumed = (identifier, db = knex) =>
  db("verifications").where({ identifier, consumed: false }).update({ consumed: true, updated_at: db.fn.now() });

export const insertOTP = (identifier, otp, db = knex) =>
  db("verifications").insert({
    identifier,
    otp,
    verified: false,
    consumed: false,
    expires_at: db.raw("now() + interval '5 minutes'"),
  });

export const findLatestUnconsumed = (identifier, db = knex) =>
  db("verifications")
    .where({ identifier, consumed: false })
    .orderBy("created_at", "desc")
    .select("id", "otp", "expires_at", "attempts")
    .first();

/**
 * Counts a wrong guess and reports the new total, so the service can burn the
 * code once it has been guessed at too many times. Atomic increment-and-return
 * rather than read-then-write: concurrent guesses against the same code must
 * not each read the same stale count and collectively get more tries than the
 * cap allows.
 */
export const recordFailedAttempt = async (id, db = knex) => {
  const [row] = await db("verifications")
    .where({ id })
    .update({ attempts: db.raw("attempts + 1"), updated_at: db.fn.now() })
    .returning(["attempts"]);
  return row?.attempts ?? 0;
};

/** Burns a code without verifying it - used when the guess cap is reached. */
export const consumeById = (id, db = knex) =>
  db("verifications").where({ id }).update({ consumed: true, updated_at: db.fn.now() });

export const markVerified = (id, db = knex) =>
  db("verifications").where({ id }).update({ verified: true, verified_at: db.fn.now(), updated_at: db.fn.now() });

// Single query, matching the original's atomic UPDATE...WHERE...RETURNING -
// only consumes (and returns non-empty) if a verified, unconsumed, in-window
// proof actually exists, so this can't be raced.
export const consumeIfProven = async (identifier, windowMinutes, db = knex) => {
  const rows = await db.raw(
    `UPDATE verifications
     SET consumed = true, updated_at = now()
     WHERE id = (
       SELECT id FROM verifications
       WHERE identifier = ?
         AND verified = true
         AND consumed = false
         AND verified_at > now() - interval '${Number(windowMinutes)} minutes'
       ORDER BY verified_at DESC
       LIMIT 1
     )
     RETURNING id`,
    [identifier]
  );
  return rows.rows.length > 0;
};
