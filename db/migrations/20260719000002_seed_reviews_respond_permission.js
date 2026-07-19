/**
 * Phase 3B — a dedicated `reviews.respond` permission.
 *
 * Separate from `settings.manage` for the same reason `offers.manage` is
 * separate from `services.manage` (see 20260715000012): replying to a review
 * publishes text under the business's name to every future customer, so it must
 * be delegable to a front-desk manager WITHOUT also handing them the ability to
 * edit the business profile, hours, and payment settings.
 *
 * Same rationale as the offers migration for why this is a migration and not
 * only a seed: seeds run manually, so an environment that already seeded would
 * never pick up a new grant and the reply route would 403 for every real owner.
 * Both are idempotent upserts, so running migration and seed together is fine.
 *
 * Staff is intentionally NOT granted it — owner grants it explicitly.
 */
export const up = async (knex) => {
  await knex("permissions")
    .insert({ key: "reviews.respond", description: "Reply publicly to customer reviews" })
    .onConflict("key")
    .merge(["description"]);

  const [permission] = await knex("permissions").where({ key: "reviews.respond" }).select("id");
  const [ownerRole] = await knex("roles").where({ key: "owner" }).select("id");

  if (permission && ownerRole) {
    await knex("role_permissions")
      .insert({ role_id: ownerRole.id, permission_id: permission.id })
      .onConflict(["role_id", "permission_id"])
      .merge();
  }
};

export const down = async (knex) => {
  const [permission] = await knex("permissions").where({ key: "reviews.respond" }).select("id");
  if (permission) {
    await knex("role_permissions").where({ permission_id: permission.id }).del();
    await knex("permissions").where({ id: permission.id }).del();
  }
};
