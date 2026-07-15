export const up = (knex) =>
  knex.schema.createTable("admins", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable();
    table.string("email", 255).notNullable().unique();
    table.string("password", 255).notNullable();
    table.string("role", 20).notNullable().defaultTo("admin");
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("last_login", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("role in ('admin', 'super_admin')", [], "chk_admins_role");
  });

export const down = (knex) => knex.schema.dropTableIfExists("admins");
