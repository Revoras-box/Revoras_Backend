/**
 * Phase 2.2 (Discovery Curation System) - Featured Businesses. Columns live
 * directly on `businesses` (not a separate table) since this is a 1:1
 * attribute set per business, same reasoning as the profile fields added in
 * 20260714000002 - no join needed to read "is this business featured right
 * now" on every discovery list query.
 *
 * `featured_region` reuses the business's own city/state vocabulary (no new
 * region taxonomy) - a target of "Jammu" matches businesses.city ILIKE
 * 'Jammu'. Null = no regional restriction (featured everywhere).
 * `featured_reason` is admin-internal only - never selected by any public
 * discovery/detail query (see discovery.repository.js).
 *
 * "Configurable featured boost without overriding relevance" (report.md
 * V4.11) - `featured_priority` feeds ranking.service.js's FEATURED_BOOST,
 * a small additive nudge layered ON TOP of the existing 5-weight composite,
 * not a 6th RANK_WEIGHTS term - the composite itself is intentionally
 * untouched so "the existing ranking algorithm" stays byte-for-byte intact.
 */
export const up = (knex) =>
  knex.schema.alterTable("businesses", (table) => {
    table.boolean("is_featured").notNullable().defaultTo(false);
    table.integer("featured_priority").notNullable().defaultTo(0);
    table.timestamp("featured_start_at", { useTz: true });
    table.timestamp("featured_end_at", { useTz: true });
    table.string("featured_region", 100);
    table.text("featured_reason");

    table.index(["is_featured", "featured_start_at", "featured_end_at"], "idx_businesses_featured_window");
  });

export const down = (knex) =>
  knex.schema.alterTable("businesses", (table) => {
    table.dropIndex(["is_featured", "featured_start_at", "featured_end_at"], "idx_businesses_featured_window");
    table.dropColumn("is_featured");
    table.dropColumn("featured_priority");
    table.dropColumn("featured_start_at");
    table.dropColumn("featured_end_at");
    table.dropColumn("featured_region");
    table.dropColumn("featured_reason");
  });
