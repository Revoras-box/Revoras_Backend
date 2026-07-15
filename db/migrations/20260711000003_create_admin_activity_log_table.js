export const up = (knex) =>
  knex.schema.createTable("admin_activity_log", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("admin_id")
      .notNullable()
      .references("id")
      .inTable("admins")
      .onDelete("RESTRICT");
    table.string("action", 255).notNullable();
    table.string("entity_type", 100).notNullable();
    table.uuid("entity_id");
    table.jsonb("details").notNullable().defaultTo("{}");
    table.string("ip_address", 64);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["admin_id"], "idx_admin_activity_log_admin_id");
  });

export const down = (knex) => knex.schema.dropTableIfExists("admin_activity_log");
