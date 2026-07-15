// Owner gets every permission. Staff gets bookings.manage only - scoped to their
// own bookings in query logic (report.md §B item 3), not expressed here.
//
// Upsert on the composite key rather than delete-then-insert - see
// 01_roles.js for why. Additive-only: if a grant is ever removed from the
// lists below, the stale row stays until manually cleaned up (no real
// deployment has hit this yet - flag it if it does).
export const seed = async (knex) => {
  const roles = await knex("roles").select("id", "key");
  const permissions = await knex("permissions").select("id", "key");

  const roleId = (key) => roles.find((r) => r.key === key).id;
  const permissionId = (key) => permissions.find((p) => p.key === key).id;

  const ownerGrants = permissions.map((p) => ({
    role_id: roleId("owner"),
    permission_id: p.id,
  }));

  const staffGrants = [
    { role_id: roleId("staff"), permission_id: permissionId("bookings.manage") },
  ];

  await knex("role_permissions")
    .insert([...ownerGrants, ...staffGrants])
    .onConflict(["role_id", "permission_id"])
    .merge();
};
