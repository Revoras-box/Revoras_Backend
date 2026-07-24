/**
 * A free-text label for services whose category is the catch-all "Other".
 *
 * Migration 20260712000002 deliberately replaced the old free-text
 * services.category with a FK into the shared `categories` taxonomy ("do not
 * allow arbitrary category strings"). This column does NOT reopen that: the
 * category_id FK still points at the real "Other" service category, so
 * grouping/filtering by category keeps working. custom_category is only a
 * display label the owner types to say what their "Other" service actually is,
 * and it's null for every service that fits a real category.
 */
export const up = async (knex) => {
  await knex.schema.alterTable("services", (table) => {
    table.string("custom_category", 100);
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable("services", (table) => {
    table.dropColumn("custom_category");
  });
};
