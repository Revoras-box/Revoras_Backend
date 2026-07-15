/**
 * The ONLY bridge between Studio (businesses) and Person (users) - report.md §2.0.
 * One row per (studio, user) pair. `provides_services` (not `role`) is what makes
 * someone bookable as a Professional - an Owner may or may not provide services,
 * a future Receptionist never does.
 */
export const up = (knex) =>
  knex.schema.createTable("business_members", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("studio_id")
      .notNullable()
      .references("id")
      .inTable("businesses")
      .onDelete("CASCADE");
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.uuid("role_id").notNullable().references("id").inTable("roles").onDelete("RESTRICT");
    table.string("designation", 100);
    table.boolean("provides_services").notNullable().defaultTo(true);
    table.jsonb("specialties").notNullable().defaultTo("[]");
    table.integer("experience_years").notNullable().defaultTo(0);
    table.decimal("rating", 3, 2).notNullable().defaultTo(0);
    table.string("image_url", 500);
    table.string("status", 20).notNullable().defaultTo("active");
    table.boolean("registration_fee_paid").notNullable().defaultTo(false);
    table.decimal("registration_fee_amount", 10, 2).notNullable().defaultTo(0);
    table.timestamp("joined_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("left_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["studio_id", "user_id"], { indexName: "uq_business_members_studio_user" });
    table.check("status in ('invited', 'active', 'inactive', 'suspended')", [], "chk_business_members_status");
    table.index(["studio_id", "status", "provides_services"], "idx_business_members_studio_status_provides");
    table.index(["user_id"], "idx_business_members_user_id");
  });

export const down = (knex) => knex.schema.dropTableIfExists("business_members");
