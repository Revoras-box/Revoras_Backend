/**
 * Phase 1.5a (feature) - support businesses that exist as an incomplete DRAFT
 * while the owner works through the onboarding wizard.
 *
 *  - `address` becomes nullable: a draft business is created at host signup
 *    before the owner has filled in Business Basics (Step 1), so it genuinely
 *    has no address yet. Discovery never shows non-active businesses, so a
 *    null address is never public. (Submitting onboarding requires it - enforced
 *    in onboarding.service, not the column.)
 *  - `onboarding_step` records the furthest wizard step reached, so "Resume"
 *    returns the owner to exactly where they left off. Autosave persists the
 *    real data (business fields, services, gallery, ...); this is just the
 *    cursor.
 */
export const up = (knex) =>
  knex.schema.alterTable("businesses", (table) => {
    table.string("address", 500).nullable().alter();
    table.smallint("onboarding_step").notNullable().defaultTo(0);
  });

export const down = async (knex) => {
  // Backfill any nulls before restoring NOT NULL so the down migration can't
  // fail on existing draft rows.
  await knex("businesses").whereNull("address").update({ address: "" });
  await knex.schema.alterTable("businesses", (table) => {
    table.dropColumn("onboarding_step");
    table.string("address", 500).notNullable().alter();
  });
};
