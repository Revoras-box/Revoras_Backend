/**
 * The Studio entity (formerly `studios`). Deliberately has no `owner_id` or any
 * other column pointing at a person - report.md §2.0 is explicit that a Studio
 * never references a User directly. `business_members` (migration 8) is the
 * only bridge.
 */
export const up = (knex) =>
  knex.schema.createTable("businesses", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable();
    table.string("slug", 255).notNullable().unique();
    table.uuid("category_id").references("id").inTable("categories").onDelete("SET NULL");
    table.string("address", 500).notNullable();
    table.string("city", 100);
    table.string("state", 100);
    table.string("zip_code", 20);
    table.string("country", 100);
    table.double("lat");
    table.double("lng");
    table.string("phone", 32);
    table.string("email", 255);
    table.text("description");
    table.string("image_url", 500);
    table.string("logo_url", 500);
    table.string("banner_url", 500);
    table.jsonb("amenities").notNullable().defaultTo("[]");
    table.decimal("rating", 3, 2).notNullable().defaultTo(0);
    table.integer("review_count").notNullable().defaultTo(0);
    table.string("approval_status", 20).notNullable().defaultTo("pending");
    table.uuid("approved_by").references("id").inTable("admins").onDelete("SET NULL");
    table.timestamp("approved_at", { useTz: true });
    table.text("rejection_reason");
    table.text("admin_notes");
    table.boolean("is_active").notNullable().defaultTo(false);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("approval_status in ('pending', 'approved', 'rejected', 'suspended')", [], "chk_businesses_approval_status");
    table.index(["category_id", "approval_status", "is_active"], "idx_businesses_category_approval_active");
    table.index(["lat", "lng"], "idx_businesses_lat_lng");
  });

export const down = (knex) => knex.schema.dropTableIfExists("businesses");
