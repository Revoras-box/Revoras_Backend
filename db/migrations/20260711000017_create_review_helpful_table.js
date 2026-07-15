export const up = (knex) =>
  knex.schema.createTable("review_helpful", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("review_id")
      .notNullable()
      .references("id")
      .inTable("reviews")
      .onDelete("CASCADE");
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["review_id", "user_id"], { indexName: "uq_review_helpful_review_user" });
  });

export const down = (knex) => knex.schema.dropTableIfExists("review_helpful");
