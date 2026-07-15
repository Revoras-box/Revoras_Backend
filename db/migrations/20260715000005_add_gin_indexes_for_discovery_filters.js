/**
 * Phase 2.1 (Advanced Filters) - GIN indexes for the jsonb array columns now
 * filtered in discovery.repository.js (amenities/payment_methods/languages/
 * accessibility, via `@>` containment - see anyOfJsonArraySql). Default `jsonb_ops` opclass
 * (not `jsonb_path_ops`) so it also supports `?`/`?|`/`?&` if a future filter
 * needs them, not just `@>`.
 *
 * Knex's schema builder has no first-class GIN helper, so these are raw DDL -
 * matches how this migration set already reaches for knex.raw()/table.check()
 * whenever the fluent builder doesn't cover a case (see business-status's
 * CHECK constraints).
 */
export const up = (knex) =>
  knex.raw(`
    create index idx_businesses_amenities_gin on businesses using gin (amenities);
    create index idx_businesses_payment_methods_gin on businesses using gin (payment_methods);
    create index idx_businesses_languages_gin on businesses using gin (languages);
    create index idx_businesses_accessibility_gin on businesses using gin (accessibility);
  `);

export const down = (knex) =>
  knex.raw(`
    drop index if exists idx_businesses_amenities_gin;
    drop index if exists idx_businesses_payment_methods_gin;
    drop index if exists idx_businesses_languages_gin;
    drop index if exists idx_businesses_accessibility_gin;
  `);
