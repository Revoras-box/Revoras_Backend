// Renamed from studio_hours per the requested table list.
export const up = (knex) =>
  knex.schema.createTable("working_hours", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("studio_id")
      .notNullable()
      .references("id")
      .inTable("businesses")
      .onDelete("CASCADE");
    table.integer("day_of_week").notNullable();
    table.time("open_time");
    table.time("close_time");
    table.boolean("is_closed").notNullable().defaultTo(false);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["studio_id", "day_of_week"], { indexName: "uq_working_hours_studio_day" });
    table.check("day_of_week between 0 and 6", [], "chk_working_hours_day_of_week");
  });

export const down = (knex) => knex.schema.dropTableIfExists("working_hours");
