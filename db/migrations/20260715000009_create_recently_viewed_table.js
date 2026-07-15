/**
 * Phase 2.3 (Favorites & Recently Viewed) - server-side view history.
 *
 * Decision D2 (hybrid): this table only ever holds views for *authenticated*
 * users, so recently-viewed follows them across devices. Anonymous visitors
 * keep the pre-existing client-side path (`Revoras/src/lib/recently-viewed.ts`,
 * localStorage) - logged-out browsing is real discovery traffic and shouldn't
 * silently lose the feature.
 *
 * **Dedup is a DB constraint, not application logic.** One row per
 * (user, target), and recording a view UPSERTs `viewed_at` on conflict. The
 * alternative - insert-then-prune-duplicates - would race with itself under
 * concurrent views of the same business (double-click, two tabs) and needs
 * app-side dedup on every read. Here "most recent view wins" is enforced by
 * the unique index, so the read path is a plain ORDER BY.
 *
 * Mirrors the `favorites` shape from 20260715000008 deliberately (nullable
 * studio_id/business_member_id + exactly-one CHECK), so both "saved" and
 * "recently viewed" answer the same business-or-professional question the same
 * way rather than inventing a second convention.
 */
export const up = async (knex) => {
  await knex.schema.createTable("recently_viewed", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.uuid("studio_id").references("id").inTable("businesses").onDelete("CASCADE");
    table.uuid("business_member_id").references("id").inTable("business_members").onDelete("CASCADE");
    table.timestamp("viewed_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    // The dedup guarantee, and the read path's index.
    //
    // Plain (non-partial) uniques, exactly like `favorites`. Postgres treats
    // NULLs as distinct, so these don't constrain rows whose column is NULL -
    // but that's harmless here: the CHECK below guarantees every row has
    // exactly one target set, so each row is always constrained by whichever
    // unique matches its populated column.
    //
    // They must NOT be partial (`WHERE studio_id IS NOT NULL`): Postgres can't
    // infer a partial index from a bare `ON CONFLICT (user_id, studio_id)`
    // without the predicate repeated, and knex's `.onConflict()` can't emit
    // one - so a partial index makes the UPSERT that powers dedup fail with
    // "no unique or exclusion constraint matching the ON CONFLICT
    // specification". Verified the hard way.
    table.unique(["user_id", "studio_id"], { indexName: "uq_recently_viewed_user_studio" });
    table.unique(["user_id", "business_member_id"], { indexName: "uq_recently_viewed_user_member" });
    table.index(["user_id", "viewed_at"], "idx_recently_viewed_user_time");
  });

  await knex.raw(`
    ALTER TABLE recently_viewed
    ADD CONSTRAINT chk_recently_viewed_exactly_one_target
    CHECK (num_nonnulls(studio_id, business_member_id) = 1)
  `);
};

export const down = (knex) => knex.schema.dropTableIfExists("recently_viewed");
