/**
 * Phase 1.5d - the ₹99/month subscription that gates PAYMENT_PENDING ->
 * PENDING_REVIEW (O4: "₹99 gates entry to review, not listing" - see
 * docs/business-lifecycle-state-machine.md). Payment mechanics reuse the
 * existing polymorphic `payments` table (report.md §3.2) rather than
 * duplicating Razorpay bookkeeping - this table only owns what's
 * subscription-specific: which plan, and the paid period's start/end.
 *
 * `payments.payable_type` gains 'subscription' alongside the existing
 * 'booking'/'staff_registration' values; Postgres has no ALTER CHECK, so the
 * constraint is dropped and recreated with the same name.
 */
export const up = async (knex) => {
  await knex.schema.createTable("business_subscriptions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    table.string("plan", 50).notNullable().defaultTo("standard_monthly");
    table.decimal("amount", 10, 2).notNullable().defaultTo(99.0);
    table.string("currency", 8).notNullable().defaultTo("INR");
    table.string("status", 20).notNullable().defaultTo("pending");
    table.timestamp("current_period_start", { useTz: true });
    table.timestamp("current_period_end", { useTz: true });
    table.timestamp("cancelled_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("status in ('pending', 'active', 'expired', 'cancelled')", [], "chk_business_subscriptions_status");
    table.index(["business_id", "status"], "idx_business_subscriptions_business_status");
  });

  await knex.schema.alterTable("payments", (table) => {
    table.dropChecks(["chk_payments_payable_type"]);
  });
  await knex.schema.alterTable("payments", (table) => {
    table.check("payable_type in ('booking', 'staff_registration', 'subscription')", [], "chk_payments_payable_type");
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable("payments", (table) => {
    table.dropChecks(["chk_payments_payable_type"]);
  });
  await knex.schema.alterTable("payments", (table) => {
    table.check("payable_type in ('booking', 'staff_registration')", [], "chk_payments_payable_type");
  });
  await knex.schema.dropTableIfExists("business_subscriptions");
};
