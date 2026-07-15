export const up = (knex) =>
  knex.schema.createTable("reviews", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.uuid("booking_id").unique().references("id").inTable("bookings").onDelete("SET NULL");
    table
      .uuid("studio_id")
      .notNullable()
      .references("id")
      .inTable("businesses")
      .onDelete("CASCADE");
    table
      .uuid("business_member_id")
      .references("id")
      .inTable("business_members")
      .onDelete("SET NULL");
    table.integer("rating").notNullable();
    table.string("title", 255);
    table.text("comment");
    table.jsonb("photos").notNullable().defaultTo("[]");
    table.integer("helpful_count").notNullable().defaultTo(0);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("rating between 1 and 5", [], "chk_reviews_rating");
    table.index(["studio_id"], "idx_reviews_studio_id");
    table.index(["business_member_id"], "idx_reviews_member_id");
  });

export const down = (knex) => knex.schema.dropTableIfExists("reviews");
