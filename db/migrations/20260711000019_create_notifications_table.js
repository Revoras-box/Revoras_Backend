/**
 * New table (report.md "Database Layer Migration to Knex.js" §B) - gives the
 * "no transactional emails for the booking lifecycle" gap a durable home.
 * This migration only creates storage; the send pipeline is a later phase.
 */
export const up = (knex) =>
  knex.schema.createTable("notifications", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("type", 50).notNullable();
    table.string("title", 255).notNullable();
    table.text("message");
    table.jsonb("data").notNullable().defaultTo("{}");
    table.string("channel", 20).notNullable().defaultTo("in_app");
    table.string("status", 20).notNullable().defaultTo("pending");
    table.timestamp("read_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("channel in ('in_app', 'email', 'sms', 'push')", [], "chk_notifications_channel");
    table.check("status in ('pending', 'sent', 'failed', 'read')", [], "chk_notifications_status");
    table.index(["user_id", "status"], "idx_notifications_user_status");
    table.index(["user_id", "read_at"], "idx_notifications_user_read_at");
  });

export const down = (knex) => knex.schema.dropTableIfExists("notifications");
