export const up = (knex) =>
  knex.schema.createTable("services", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("studio_id")
      .notNullable()
      .references("id")
      .inTable("businesses")
      .onDelete("CASCADE");
    table.string("name", 255).notNullable();
    table.text("description");
    table.string("category", 100).notNullable().defaultTo("General");
    table.decimal("price", 10, 2).notNullable();
    table.integer("duration").notNullable();
    table.string("image_url", 500);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["studio_id", "is_active", "category"], "idx_services_studio_active_category");
  });

export const down = (knex) => knex.schema.dropTableIfExists("services");
