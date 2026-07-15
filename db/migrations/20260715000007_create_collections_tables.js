/**
 * Phase 2.2 (Discovery Curation System) - editorial collections ("Best
 * Barbers in Jammu", "Bridal Makeup Experts", ...). Deliberately two small
 * normalized tables, no new SQL for *which businesses match* a collection's
 * filter criteria - that's resolved at read time by re-calling
 * discovery.repository.js's listBusinesses with the collection's stored
 * filter columns (same reuse principle as everything else in this migration
 * set: one query engine, not a second one per feature).
 *
 * `collection_items` only stores manually PINNED businesses (curator picks
 * that should always appear, in a specific order) - the rest of a
 * collection's membership is computed live from its filter_* columns, so
 * adding a new business that matches (e.g. a new 4.6-rated verified salon in
 * Jammu) shows up in "Best Barbers in Jammu" automatically without an admin
 * touching the collection.
 */
export const up = async (knex) => {
  await knex.schema.createTable("collections", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("title", 255).notNullable();
    table.string("subtitle", 500);
    table.string("slug", 255).notNullable().unique();
    table.string("cover_image_url", 500);
    table.text("description");
    table.integer("display_order").notNullable().defaultTo(0);
    table.boolean("is_active").notNullable().defaultTo(true);
    table.timestamp("start_at", { useTz: true });
    table.timestamp("end_at", { useTz: true });

    // Region targeting - reuses the business city/state vocabulary, no new taxonomy.
    table.string("target_city", 100);
    table.string("target_state", 100);

    // Filter criteria resolved via discovery.repository.js's listBusinesses -
    // same columns/semantics as the Phase 2.1 Advanced Filters query params.
    table.uuid("filter_category_id").references("id").inTable("categories").onDelete("SET NULL");
    table.decimal("filter_min_rating", 3, 2);
    table.boolean("filter_verified_only").notNullable().defaultTo(false);
    table.boolean("filter_premium_only").notNullable().defaultTo(false);

    table.uuid("created_by").references("id").inTable("admins").onDelete("SET NULL");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["is_active", "display_order"], "idx_collections_active_order");
  });

  await knex.schema.createTable("collection_items", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("collection_id").notNullable().references("id").inTable("collections").onDelete("CASCADE");
    table.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(["collection_id", "business_id"], { indexName: "uq_collection_items_collection_business" });
    table.index(["collection_id", "sort_order"], "idx_collection_items_collection_sort");
  });
};

export const down = async (knex) => {
  await knex.schema.dropTableIfExists("collection_items");
  await knex.schema.dropTableIfExists("collections");
};
