/**
 * `appointment_date`/`appointment_time`/`total_price` from the old schema are
 * gone (report.md §1.2) - they were duplicates of booking_date/start_time/
 * total_amount kept "in lockstep" by application code, a drift risk with no
 * upside now that a real migration tool exists to fix it.
 *
 * The EXCLUDE constraint is DB-enforced double-booking prevention (report.md
 * §3.5) - a second, stronger guarantee on top of the pg_advisory_xact_lock
 * pattern the booking service will still use, not a replacement for it.
 */
export const up = async (knex) => {
  await knex.schema.createTable("bookings", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("RESTRICT");
    table
      .uuid("studio_id")
      .notNullable()
      .references("id")
      .inTable("businesses")
      .onDelete("RESTRICT");
    table
      .uuid("business_member_id")
      .notNullable()
      .references("id")
      .inTable("business_members")
      .onDelete("RESTRICT");
    table.date("booking_date").notNullable();
    table.time("start_time").notNullable();
    table.time("end_time").notNullable();
    table.decimal("total_amount", 10, 2).notNullable().defaultTo(0);
    table.integer("total_duration").notNullable().defaultTo(0);
    table.text("notes");
    table.string("status", 20).notNullable().defaultTo("pending");
    table.uuid("payment_id").references("id").inTable("payments").onDelete("SET NULL");
    table.string("confirmation_code", 50).unique();
    table.text("cancellation_reason");
    table.timestamp("cancelled_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check(
      "status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')",
      [],
      "chk_bookings_status"
    );
    table.index(["studio_id", "business_member_id", "booking_date"], "idx_bookings_studio_member_date");
    table.index(["user_id", "status", "booking_date"], "idx_bookings_user_status_date");
  });

  await knex.raw(`
    ALTER TABLE bookings
    ADD CONSTRAINT excl_bookings_no_overlap
    EXCLUDE USING gist (
      business_member_id WITH =,
      tsrange(booking_date + start_time, booking_date + end_time) WITH &&
    )
    WHERE (status <> 'cancelled');
  `);
};

export const down = (knex) => knex.schema.dropTableIfExists("bookings");
