/**
 * Phase 2.3 (Favorites & Recently Viewed) - lets a user favorite a
 * *professional*, not just a business.
 *
 * Decision D3: one `favorites` table with a nullable `studio_id` /
 * `business_member_id` pair and a CHECK that exactly one is set - rather than a
 * second `professional_favorites` table. The deciding factor is the "Saved"
 * page, which lists both kinds newest-first: one table makes that a single
 * ordered query, where two tables would need a UNION (and a second repository)
 * to answer the same question.
 *
 * This is NOT the generic polymorphic `favoritable_type`/`favoritable_id`
 * pattern report.md §2.0 rejects: both columns are real, typed, FK-enforced
 * references with ON DELETE CASCADE. The DB still guarantees a favorite points
 * at a row that exists - which a string-keyed polymorphic FK cannot do.
 *
 * The pre-existing `uq_favorites_user_studio` keeps working as-is: Postgres
 * treats NULLs as distinct in a unique index, so professional rows (studio_id
 * NULL) never collide with each other under it, and are instead constrained by
 * the new `uq_favorites_user_member`.
 */
export const up = async (knex) => {
  // Raw rather than knex's .alter(): .alter() re-emits the whole column
  // definition (dropping the default along with it) to change one property.
  // Only the NOT NULL is meant to change here.
  await knex.raw(`ALTER TABLE favorites ALTER COLUMN studio_id DROP NOT NULL`);

  await knex.schema.alterTable("favorites", (table) => {
    table.uuid("business_member_id").references("id").inTable("business_members").onDelete("CASCADE");
    table.unique(["user_id", "business_member_id"], { indexName: "uq_favorites_user_member" });
  });

  await knex.raw(`
    ALTER TABLE favorites
    ADD CONSTRAINT chk_favorites_exactly_one_target
    CHECK (num_nonnulls(studio_id, business_member_id) = 1)
  `);
};

export const down = async (knex) => {
  // Professional favorites have no representation in the old business-only
  // shape, so they must go before studio_id can be NOT NULL again. Dropping
  // rows is correct here (a rollback is discarding this feature) but is
  // deliberately explicit rather than a surprise from a failing NOT NULL.
  await knex("favorites").whereNull("studio_id").del();

  await knex.raw(`ALTER TABLE favorites DROP CONSTRAINT IF EXISTS chk_favorites_exactly_one_target`);
  await knex.schema.alterTable("favorites", (table) => {
    table.dropUnique(["user_id", "business_member_id"], "uq_favorites_user_member");
    table.dropColumn("business_member_id");
  });
  await knex.raw(`ALTER TABLE favorites ALTER COLUMN studio_id SET NOT NULL`);
};
