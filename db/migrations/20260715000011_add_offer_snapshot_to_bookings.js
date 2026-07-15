/**
 * Phase 2.4 (Offers & Promotions) - decision D1: snapshot the applied offer
 * onto the booking rather than recomputing it.
 *
 * `total_amount` KEEPS its existing meaning as the payable amount - it just
 * becomes the POST-discount figure. That's the whole reason payment.service.js
 * needs no change: it reads bookings.total_amount → paise, and now that value
 * is already discounted. `original_amount` preserves the pre-discount sum so a
 * booking can still show "₹800 ₹640" and reconcile.
 *
 * Snapshotting (not recompute-on-read) is a correctness requirement, not an
 * optimization: an offer that is later edited, deactivated, or expires must not
 * retroactively change what a past customer was charged. `offer_id` is
 * ON DELETE SET NULL so deleting an offer doesn't cascade-delete the bookings
 * that used it - the frozen `discount_amount`/`original_amount` still stand.
 *
 * A single nullable `offer_id` (not a join table) is also the no-double-discount
 * guarantee: a booking references at most one offer, structurally.
 */
export const up = async (knex) => {
  await knex.schema.alterTable("bookings", (table) => {
    table.uuid("offer_id").references("id").inTable("offers").onDelete("SET NULL");
    table.decimal("original_amount", 10, 2); // pre-discount; null on pre-2.4 rows
    table.decimal("discount_amount", 10, 2).notNullable().defaultTo(0);

    table.index("offer_id", "idx_bookings_offer");
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable("bookings", (table) => {
    table.dropIndex("offer_id", "idx_bookings_offer");
    table.dropColumn("offer_id");
    table.dropColumn("original_amount");
    table.dropColumn("discount_amount");
  });
};
