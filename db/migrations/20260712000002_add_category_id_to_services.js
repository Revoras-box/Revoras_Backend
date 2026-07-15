/**
 * Replaces services.category (free text, per-business, no shared vocabulary)
 * with a real FK into categories (type='service') - report.md Phase 2.2 plan,
 * "do not allow arbitrary category strings." Backfill maps existing free-text
 * values to the closest new service category by name, falling back to a
 * catch-all "Other" service category for anything unmatched, then the old
 * column is dropped - same clean-cutover approach as migration 1's legacy
 * table drop, this repo has no real production data to protect yet.
 */
export const up = async (knex) => {
  await knex.schema.alterTable("services", (table) => {
    table.uuid("category_id").references("id").inTable("categories").onDelete("RESTRICT");
  });

  // Don't depend on seed order (migrations can run before seeds on a fresh
  // DB) - create the catch-all fallback here if it doesn't exist yet. The
  // seed re-asserts the same row by slug afterward, no duplicate.
  let fallback = await knex("categories").where({ slug: "other", type: "service" }).first();
  if (!fallback) {
    [fallback] = await knex("categories")
      .insert({ name: "Other", slug: "other", icon: "category", sort_order: 99, type: "service" })
      .returning("*");
  }

  const serviceCategories = await knex("categories").where({ type: "service" }).select("id", "name");
  const distinctFreeTextCategories = await knex("services").distinct("category").whereNotNull("category");

  for (const { category } of distinctFreeTextCategories) {
    const match = serviceCategories.find((c) => c.name.toLowerCase() === String(category).trim().toLowerCase());
    await knex("services")
      .where({ category })
      .update({ category_id: (match || fallback).id });
  }

  await knex("services").whereNull("category_id").update({ category_id: fallback.id });

  await knex.schema.alterTable("services", (table) => {
    table.uuid("category_id").notNullable().alter();
    table.dropColumn("category");
    table.index(["studio_id", "is_active", "category_id"], "idx_services_studio_active_category_id");
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable("services", (table) => {
    table.dropIndex(["studio_id", "is_active", "category_id"], "idx_services_studio_active_category_id");
    table.string("category", 100).notNullable().defaultTo("General");
  });

  await knex.raw(`
    UPDATE services SET category = categories.name
    FROM categories WHERE services.category_id = categories.id
  `);

  await knex.schema.alterTable("services", (table) => {
    table.dropColumn("category_id");
  });
};
