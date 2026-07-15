/**
 * Replaces password.controller.js's old in-memory Map of reset tokens
 * (didn't survive a restart, per-instance only - the exact class of bug
 * already fixed for signup OTPs via the `verifications` table). Stores a
 * SHA-256 hash of the token, not the token itself, so a DB read doesn't hand
 * out a working reset link.
 */
export const up = (knex) =>
  knex.schema.createTable("password_reset_tokens", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("token_hash", 64).notNullable().unique();
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.boolean("consumed").notNullable().defaultTo(false);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["user_id"], "idx_password_reset_tokens_user_id");
  });

export const down = (knex) => knex.schema.dropTableIfExists("password_reset_tokens");
