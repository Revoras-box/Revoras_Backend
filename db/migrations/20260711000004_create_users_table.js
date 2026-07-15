/**
 * The single identity table for every human who isn't a platform admin -
 * customers and business members alike. See report.md §2.0/§2.2: this table
 * never references, and is never referenced by, `businesses` directly - the
 * only bridge is `business_members` (migration 8).
 */
export const up = (knex) =>
  knex.schema.createTable("users", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable();
    table.string("email", 255).notNullable().unique();
    table.string("phone", 32).unique();
    table.string("password", 255);
    table.string("google_id", 255).unique();
    table.string("avatar_url", 500);
    table.date("date_of_birth");
    table.string("gender", 20);
    table.jsonb("preferences").notNullable().defaultTo("{}");
    table.jsonb("notification_settings").notNullable().defaultTo("{}");
    table.boolean("email_verified").notNullable().defaultTo(false);
    table.boolean("phone_verified").notNullable().defaultTo(false);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

export const down = (knex) => knex.schema.dropTableIfExists("users");
