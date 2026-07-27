/**
 * Per-OTP guess counter.
 *
 * A 6-digit code is only 1,000,000 possibilities, which is fine *provided*
 * each issued code gets a handful of tries. Until now nothing counted: the
 * only thing between an attacker and a code was the auth rate limiter, which
 * lives in each process's memory - so it resets on deploy, and each instance
 * behind a load balancer grants its own budget. This puts the counter next to
 * the code it protects, in the database, where it is shared and durable.
 *
 * Existing rows default to 0, which is the correct starting value for a code
 * nobody has guessed at yet.
 */
export const up = (knex) =>
  knex.schema.alterTable("verifications", (table) => {
    table.integer("attempts").notNullable().defaultTo(0);
  });

export const down = (knex) =>
  knex.schema.alterTable("verifications", (table) => {
    table.dropColumn("attempts");
  });
