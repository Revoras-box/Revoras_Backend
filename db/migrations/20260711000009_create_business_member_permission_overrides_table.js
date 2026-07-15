/**
 * Future-proofing only (report.md §3.2) - no UI surface in V2, but the table
 * costs nothing to have ready if a specific staff member ever needs a permission
 * beyond their role's default (e.g. one trusted with payments.view).
 */
export const up = (knex) =>
  knex.schema.createTable("business_member_permission_overrides", (table) => {
    table
      .uuid("business_member_id")
      .notNullable()
      .references("id")
      .inTable("business_members")
      .onDelete("CASCADE");
    table
      .uuid("permission_id")
      .notNullable()
      .references("id")
      .inTable("permissions")
      .onDelete("CASCADE");
    table.boolean("granted").notNullable();
    table.primary(["business_member_id", "permission_id"]);
  });

export const down = (knex) => knex.schema.dropTableIfExists("business_member_permission_overrides");
