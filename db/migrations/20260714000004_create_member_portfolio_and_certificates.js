/**
 * Phase 1.3b - Professional Portfolio & Certificate media. Two normalized
 * per-row tables (NOT jsonb arrays on business_members) so each media item has
 * its own id for upload/reorder/cover/delete, mirroring `business_gallery_images`
 * - keyed by business_member_id instead of studio_id.
 *
 * Uploads flow Controller → MediaService → StorageProvider → R2 (folders
 * `portfolios` / `certificates`, already in MEDIA_FOLDERS). Only `media_url`
 * (the public URL) is persisted here.
 */
export const up = async (knex) => {
  await knex.schema.createTable("member_portfolio", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("business_member_id")
      .notNullable()
      .references("id")
      .inTable("business_members")
      .onDelete("CASCADE");
    table.string("media_url", 500).notNullable();
    table.string("thumbnail_url", 500);
    table.string("caption", 500);
    table.integer("sort_order").notNullable().defaultTo(0);
    table.boolean("is_cover").notNullable().defaultTo(false);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["business_member_id", "sort_order"], "idx_member_portfolio_member_sort");
  });

  await knex.schema.createTable("member_certificates", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table
      .uuid("business_member_id")
      .notNullable()
      .references("id")
      .inTable("business_members")
      .onDelete("CASCADE");
    table.string("title", 200).notNullable();
    table.string("issuer", 200).notNullable();
    table.date("issued_date");
    table.date("expiry_date");
    table.string("credential_id", 200);
    table.string("verification_url", 500);
    table.string("media_url", 500);
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["business_member_id", "sort_order"], "idx_member_certificates_member_sort");
  });
};

export const down = async (knex) => {
  await knex.schema.dropTableIfExists("member_certificates");
  await knex.schema.dropTableIfExists("member_portfolio");
};
