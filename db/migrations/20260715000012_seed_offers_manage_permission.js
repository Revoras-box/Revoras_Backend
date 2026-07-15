/**
 * Phase 2.4 (Offers & Promotions) - decision D4: a dedicated `offers.manage`
 * permission, separate from `services.manage`, so offers (which set real
 * pricing) are separately delegable.
 *
 * Permissions normally live only in `db/seeds/02_permissions.js`, but seeds run
 * manually - an existing environment that already ran its seeds won't pick up a
 * new grant, and the offers routes would then 403 for every real owner. This
 * migration upserts the permission and grants it to the `owner` role so
 * `migrate:latest` alone makes offers usable. The seed carries the same row for
 * fresh databases (both are idempotent upserts, so running both is harmless).
 *
 * Staff is intentionally NOT granted it - same policy as the seed
 * (owner = all, staff = bookings.manage only).
 */
export const up = async (knex) => {
  await knex("permissions")
    .insert({ key: "offers.manage", description: "Create, update, and remove promotional offers" })
    .onConflict("key")
    .merge(["description"]);

  const [permission] = await knex("permissions").where({ key: "offers.manage" }).select("id");
  const [ownerRole] = await knex("roles").where({ key: "owner" }).select("id");

  // roles are seeded before any migration that references them; guard anyway so
  // this can't throw on a partially-seeded DB - it just no-ops until the role exists.
  if (permission && ownerRole) {
    await knex("role_permissions")
      .insert({ role_id: ownerRole.id, permission_id: permission.id })
      .onConflict(["role_id", "permission_id"])
      .merge();
  }
};

export const down = async (knex) => {
  const [permission] = await knex("permissions").where({ key: "offers.manage" }).select("id");
  if (permission) {
    await knex("role_permissions").where({ permission_id: permission.id }).del();
    await knex("permissions").where({ id: permission.id }).del();
  }
};
