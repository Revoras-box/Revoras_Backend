/**
 * Centralizes what was scattered across bookings.razorpay_* and barbers.registration_*
 * (report.md §1.2/§3.2). `payable_id` is deliberately not a foreign key - it's
 * polymorphic (points into `bookings` or `business_members` depending on
 * `payable_type`), and Postgres can't express a FK that targets either of two
 * tables. Integrity for that pointer is enforced in the service layer, not the DB.
 */
export const up = (knex) =>
  knex.schema.createTable("payments", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("payable_type", 30).notNullable();
    table.uuid("payable_id").notNullable();
    table.uuid("user_id").references("id").inTable("users").onDelete("SET NULL");
    table.decimal("amount", 10, 2).notNullable().defaultTo(0);
    table.string("currency", 8).notNullable().defaultTo("INR");
    table.string("status", 20).notNullable().defaultTo("pending");
    table.string("razorpay_order_id", 255);
    table.string("razorpay_payment_id", 255).unique();
    table.timestamp("verified_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("payable_type in ('booking', 'staff_registration')", [], "chk_payments_payable_type");
    table.check("status in ('pending', 'paid', 'failed', 'refunded')", [], "chk_payments_status");
    table.index(["payable_type", "payable_id"], "idx_payments_payable");
    table.index(["user_id"], "idx_payments_user_id");
  });

export const down = (knex) => knex.schema.dropTableIfExists("payments");
