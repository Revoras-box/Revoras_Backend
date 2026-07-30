/**
 * Reschedule Protection - a paid, opt-in add-on bought at checkout that lets a
 * customer move their appointment right up to a cutoff before it starts.
 *
 * Two halves:
 *
 *  1. `businesses.reschedule_policy` - the owner's terms. Nothing about this
 *     feature is hardcoded: whether it's offered at all, what it costs, how
 *     close to the appointment a move is still allowed, and how many moves one
 *     purchase buys are all per-business. The default below (₹2, 2h, one move)
 *     is what every existing business inherits so the feature is live without a
 *     data backfill, and an owner can change any of it from Settings.
 *
 *  2. Per-booking columns. `reschedule_addon` is deliberately NULLABLE and has
 *     no default: NULL means "this booking predates the add-on" and keeps the
 *     old behaviour (reschedule allowed unless the cancellation policy's hard
 *     cutoff blocks it), while true/false is a real choice the customer made at
 *     checkout. That's what stops this migration from silently voiding the
 *     reschedule rights of every booking already in the table.
 *
 *     `reschedule_terms` snapshots the policy AS PURCHASED. The live policy is
 *     the right thing to quote a new booking, but it would be wrong to judge an
 *     existing one by terms the owner changed after the customer paid.
 */
const DEFAULT_RESCHEDULE_POLICY = {
  enabled: true,
  feeAmount: 2,
  cutoffHours: 2,
  maxReschedules: 1,
};

export const up = async (knex) => {
  await knex.schema.alterTable("businesses", (table) => {
    table.jsonb("reschedule_policy").notNullable().defaultTo(JSON.stringify(DEFAULT_RESCHEDULE_POLICY));
  });

  await knex.schema.alterTable("bookings", (table) => {
    // NULL = booked before this feature existed (grandfathered), true = the
    // customer bought protection, false = they were offered it and declined.
    table.boolean("reschedule_addon");
    // The money actually charged for it, kept as its own column (not just
    // folded into total_amount) so the checkout breakdown, refunds and any
    // future reporting can see the add-on separately from the services.
    table.decimal("reschedule_addon_fee", 10, 2).notNullable().defaultTo(0);
    // { feeAmount, cutoffHours, maxReschedules } frozen at purchase time.
    table.jsonb("reschedule_terms");
    // How many times this booking has already been moved by the customer,
    // checked against the purchased maxReschedules.
    table.integer("reschedule_count").notNullable().defaultTo(0);
    table.timestamp("rescheduled_at", { useTz: true });
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable("bookings", (table) => {
    table.dropColumn("reschedule_addon");
    table.dropColumn("reschedule_addon_fee");
    table.dropColumn("reschedule_terms");
    table.dropColumn("reschedule_count");
    table.dropColumn("rescheduled_at");
  });
  await knex.schema.alterTable("businesses", (table) => table.dropColumn("reschedule_policy"));
};
