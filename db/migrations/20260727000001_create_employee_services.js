/**
 * Per-employee service catalogue.
 *
 * The salon has ONE "Haircut". What changes between chairs is how long it takes
 * and what it costs: a senior barber does it in 25 minutes, someone newer takes
 * 40. Before this table those facts had nowhere to live, so `services.duration`
 * had to stand for every professional at once - and the availability grid was
 * forced to pick a single studio-wide rhythm that fit nobody exactly.
 *
 * The owner still owns the catalogue. This table only records, per employee,
 * WHICH of the shop's services they perform and HOW LONG they take. The
 * employee configures nothing.
 *
 * `price` is nullable on purpose: null means "charge the catalogue price", which
 * is the overwhelmingly common case. Only a genuinely different price is stored,
 * so a catalogue price change still flows through to every employee who hasn't
 * been given an explicit override.
 *
 * Fallback, not requirement: a member with ZERO rows here performs the whole
 * catalogue at catalogue durations - the same "absence means not configured"
 * rule member_working_hours uses. The backfill below means no existing member
 * actually relies on it, but it guarantees nobody can be made unbookable by a
 * row that failed to get written.
 */
export const up = async (knex) => {
  await knex.schema.createTable("employee_services", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("business_member_id")
      .notNullable()
      .references("id")
      .inTable("business_members")
      .onDelete("CASCADE");
    table
      .uuid("service_id")
      .notNullable()
      .references("id")
      .inTable("services")
      .onDelete("CASCADE");

    // This employee's own time for this service. Not nullable: an assignment
    // with no duration cannot be scheduled, and silently falling back to the
    // catalogue duration would hide a half-finished configuration.
    table.integer("duration").notNullable();
    table.decimal("price", 10, 2);
    // Unassigning is a toggle, not a delete, so an owner who turns a service off
    // for one employee and back on next week doesn't lose the duration they
    // carefully entered.
    table.boolean("is_enabled").notNullable().defaultTo(true);

    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["business_member_id", "service_id"], { indexName: "uq_employee_services_member_service" });
    table.index(["business_member_id", "is_enabled"], "idx_employee_services_member_enabled");
    table.check("duration > 0", [], "chk_employee_services_duration");
    table.check("price is null or price >= 0", [], "chk_employee_services_price");
  });

  // Backfill: every bookable member performs everything their shop sells, at the
  // catalogue duration. That is exactly what the system did before this table
  // existed, so no professional's availability moves on the day this ships - and
  // the owner's new "services this employee performs" screen opens fully
  // populated instead of empty, which would read as data loss.
  //
  // Inactive services are included deliberately: `services.is_active` still gates
  // them everywhere, and seeding the row now means reactivating a service later
  // doesn't silently leave every employee unassigned from it.
  await knex.raw(`
    INSERT INTO employee_services (business_member_id, service_id, duration)
    SELECT bm.id, s.id, s.duration
    FROM business_members bm
    JOIN services s ON s.studio_id = bm.studio_id
    WHERE bm.status = 'active' AND bm.provides_services = true
    ON CONFLICT (business_member_id, service_id) DO NOTHING;
  `);
};

export const down = (knex) => knex.schema.dropTableIfExists("employee_services");
