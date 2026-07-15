/**
 * Phase 2.3 (report.md Phase 2 plan) auth/security hardening:
 * - token_version: bumped on password change/reset to invalidate every JWT
 *   issued before that point (lightweight revocation - no blocklist table
 *   needed, since a token's `tv` claim just has to match the current value).
 * - failed_login_attempts / locked_until: per-ACCOUNT lockout after repeated
 *   bad passwords, independent of authLimiter's per-IP rate limiting (an
 *   attacker rotating IPs bypasses IP limits but not this).
 */
export const up = (knex) =>
  knex.schema.alterTable("users", (table) => {
    table.integer("token_version").notNullable().defaultTo(0);
    table.integer("failed_login_attempts").notNullable().defaultTo(0);
    table.timestamp("locked_until", { useTz: true });
  });

export const down = (knex) =>
  knex.schema.alterTable("users", (table) => {
    table.dropColumn("token_version");
    table.dropColumn("failed_login_attempts");
    table.dropColumn("locked_until");
  });
