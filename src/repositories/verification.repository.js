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
    .select("id", "otp", "expires_at")
    .first();

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
