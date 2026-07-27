/**
 * Per-professional weekly schedules.
 *
 * `working_hours` is keyed on studio_id alone - it says when the SHOP is open,
 * which was the only schedule the availability endpoint could ever have used
 * (and in practice it used neither: slots came from a hardcoded 09:00-20:00
 * array). A two-chair studio where one barber works mornings and the other
 * evenings had no way to express that, so both were offered the same slots.
 *
 * Fallback, not requirement: a member with ZERO rows here follows the shop's
 * hours, which is what every existing member does today. That keeps this
 * migration purely additive - no backfill, no behaviour change until an owner
 * actually sets someone's schedule.
 *
 * Rows here are still intersected with the shop's hours at read time (see
 * availability.service.js). A member cannot be bookable while the shop is
 * shut, so this table can only ever narrow availability, never widen it.
 */
export const up = async (knex) => {
  await knex.schema.createTable("member_working_hours", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("business_member_id")
      .notNullable()
      .references("id")
      .inTable("business_members")
      .onDelete("CASCADE");
    table.integer("day_of_week").notNullable();
    table.time("start_time");
    table.time("end_time");
    table.boolean("is_off").notNullable().defaultTo(false);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["business_member_id", "day_of_week"], {
      indexName: "uq_member_working_hours_member_day",
    });
    table.check("day_of_week between 0 and 6", [], "chk_member_working_hours_day_of_week");
    // A working day must carry both ends of its range; a day off carries
    // neither. Enforced here so the slot generator can trust the row.
    table.check(
      "(is_off = true) or (start_time is not null and end_time is not null and end_time > start_time)",
      [],
      "chk_member_working_hours_range"
    );
  });

  // Slot granularity was hardcoded to 30 minutes. A salon running 20-minute
  // trims and one running 1-hour colour appointments want different grids;
  // 30 stays the default so nothing shifts under existing businesses.
  await knex.schema.alterTable("businesses", (table) => {
    table.integer("slot_interval_minutes").notNullable().defaultTo(30);
  });

  await knex.raw(`
    ALTER TABLE businesses
    ADD CONSTRAINT chk_businesses_slot_interval
    CHECK (slot_interval_minutes in (5, 10, 15, 20, 30, 60));
  `);
};

export const down = async (knex) => {
  await knex.raw("ALTER TABLE businesses DROP CONSTRAINT IF EXISTS chk_businesses_slot_interval;");
  await knex.schema.alterTable("businesses", (table) => {
    table.dropColumn("slot_interval_minutes");
  });
  await knex.schema.dropTableIfExists("member_working_hours");
};
