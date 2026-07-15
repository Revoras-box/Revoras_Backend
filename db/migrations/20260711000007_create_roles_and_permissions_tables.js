/**
 * DB-driven authorization (report.md §3.2 / §4.1). Adding a Manager/Receptionist/
 * Assistant role later is a data seed into these tables, never a migration.
 */
export const up = async (knex) => {
  await knex.schema.createTable("roles", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("key", 50).notNullable().unique();
    table.string("name", 100).notNullable();
    table.boolean("is_system").notNullable().defaultTo(true);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("permissions", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("key", 100).notNullable().unique();
    table.string("description", 255);
  });

  await knex.schema.createTable("role_permissions", (table) => {
    table.uuid("role_id").notNullable().references("id").inTable("roles").onDelete("CASCADE");
    table.uuid("permission_id").notNullable().references("id").inTable("permissions").onDelete("CASCADE");
    table.primary(["role_id", "permission_id"]);
  });
};

export const down = async (knex) => {
  await knex.schema.dropTableIfExists("role_permissions");
  await knex.schema.dropTableIfExists("permissions");
  await knex.schema.dropTableIfExists("roles");
};
