// Renamed from barber_time_off per the requested table list.
export const up = (knex) =>
  knex.schema.createTable("time_off", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("studio_id")
      .notNullable()
      .references("id")
      .inTable("businesses")
      .onDelete("CASCADE");
    table
      .uuid("business_member_id")
      .notNullable()
      .references("id")
      .inTable("business_members")
      .onDelete("CASCADE");
    table.date("date").notNullable();
    table.time("start_time");
    table.time("end_time");
    table.boolean("is_full_day").notNullable().defaultTo(false);
    table.text("reason");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["business_member_id", "date"], "idx_time_off_member_date");
  });

export const down = (knex) => knex.schema.dropTableIfExists("time_off");
