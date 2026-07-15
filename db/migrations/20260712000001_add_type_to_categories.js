/**
 * Phase 2.2 (report.md Phase 2 plan): the categories table so far only carried
 * business-type taxonomy (Barbershop, Salon, ...) for businesses.category_id.
 * Services now need their own taxonomy (Haircut, Beard, Hair Color, ...) for
 * the future customer "browse by category" rail - same centralized table,
 * distinguished by `type` rather than a second parallel table, so there's
 * still exactly one Categories table to query throughout the backend.
 */
export const up = async (knex) => {
  await knex.schema.alterTable("categories", (table) => {
    table.string("type", 20).notNullable().defaultTo("business");
  });

  await knex.raw(
    `ALTER TABLE categories ADD CONSTRAINT chk_categories_type CHECK (type in ('business', 'service'))`
  );

  await knex.schema.alterTable("categories", (table) => {
    table.index(["type", "sort_order"], "idx_categories_type_sort_order");
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable("categories", (table) => {
    table.dropIndex(["type", "sort_order"], "idx_categories_type_sort_order");
  });
  await knex.raw(`ALTER TABLE categories DROP CONSTRAINT chk_categories_type`);
  await knex.schema.alterTable("categories", (table) => {
    table.dropColumn("type");
  });
};
