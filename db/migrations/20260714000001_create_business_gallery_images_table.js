/**
 * Phase 1.1 (report.md V4 roadmap): multi-image business gallery, on top of
 * the single image_url/logo_url/banner_url columns businesses already has.
 * One row per uploaded image rather than a jsonb array on `businesses` -
 * ordering/cover-selection/delete are per-row operations that don't need a
 * read-modify-write of the whole array, and a plain FK + index is enough
 * here without inventing a generic "media" table this phase doesn't need.
 */
export const up = (knex) =>
  knex.schema.createTable("business_gallery_images", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("studio_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    table.string("url", 500).notNullable();
    table.integer("sort_order").notNullable().defaultTo(0);
    table.boolean("is_cover").notNullable().defaultTo(false);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["studio_id", "sort_order"], "idx_business_gallery_images_studio_sort");
  });

export const down = (knex) => knex.schema.dropTableIfExists("business_gallery_images");
