/**
 * Cross-business taxonomy for the Discover "Categories" rail (report.md §3.2) -
 * fixes services.category being free text set independently per business, which
 * gave no shared vocabulary to browse by.
 */
export const up = (knex) =>
  knex.schema.createTable("categories", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 100).notNullable();
    table.string("slug", 100).notNullable().unique();
    table.string("icon", 100);
    table.integer("sort_order").notNullable().defaultTo(0);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

export const down = (knex) => knex.schema.dropTableIfExists("categories");
