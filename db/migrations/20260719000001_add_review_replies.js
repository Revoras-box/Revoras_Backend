/**
 * Phase 3B — business replies to reviews.
 *
 * Modelled as columns on `reviews` rather than a `review_replies` table because
 * a review gets at most ONE business reply, ever. A one-to-one relationship in a
 * child table buys nothing here and costs a join on the busiest read path in the
 * app (the public business detail page lists reviews on every load).
 *
 * `replied_by` records WHICH member of the business answered — owners delegate
 * this, and "who said that on our behalf" is exactly the question you need
 * answered when a reply goes wrong. ON DELETE SET NULL so removing a staff
 * account doesn't erase or cascade-delete the customer-visible reply text.
 *
 * `reply` is nullable and its presence IS the state: null = unanswered. That's
 * what makes a "pending reviews" dashboard metric a plain `where reply is null`
 * rather than a separate status column that could drift out of sync with the text.
 */
export const up = async (knex) => {
  await knex.schema.alterTable("reviews", (table) => {
    table.text("reply");
    table.timestamp("replied_at", { useTz: true });
    table.uuid("replied_by").references("id").inTable("users").onDelete("SET NULL");
  });

  // Partial index: the dashboard's "needs a reply" query only ever scans the
  // unanswered rows, which are a shrinking minority on a healthy business.
  await knex.raw(
    `create index idx_reviews_awaiting_reply on reviews (studio_id, created_at desc) where reply is null`
  );
};

export const down = async (knex) => {
  await knex.raw(`drop index if exists idx_reviews_awaiting_reply`);
  await knex.schema.alterTable("reviews", (table) => {
    table.dropColumn("reply");
    table.dropColumn("replied_at");
    table.dropColumn("replied_by");
  });
};
