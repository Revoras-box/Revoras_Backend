export const up = (knex) =>
  knex.schema.createTable("booking_services", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("booking_id")
      .notNullable()
      .references("id")
      .inTable("bookings")
      .onDelete("CASCADE");
    table
      .uuid("service_id")
      .notNullable()
      .references("id")
      .inTable("services")
      .onDelete("RESTRICT");
    table.decimal("price", 10, 2);
    table.integer("duration");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["booking_id"], "idx_booking_services_booking_id");
  });

export const down = (knex) => knex.schema.dropTableIfExists("booking_services");
