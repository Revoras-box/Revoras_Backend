// Renamed from user_favorites per the requested table list.
export const up = (knex) =>
  knex.schema.createTable("favorites", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table
      .uuid("studio_id")
      .notNullable()
      .references("id")
      .inTable("businesses")
      .onDelete("CASCADE");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["user_id", "studio_id"], { indexName: "uq_favorites_user_studio" });
  });

export const down = (knex) => knex.schema.dropTableIfExists("favorites");
