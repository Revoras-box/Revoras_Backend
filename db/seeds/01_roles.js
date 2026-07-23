// System roles for V2 (report.md §2.3). Manager/Receptionist/Assistant are added
// later as more rows here plus a role_permissions seed - never a migration.
//
// Upsert-by-key rather than delete-then-insert: business_members.role_id is
// ON DELETE RESTRICT (a role actively assigned to a member can't be deleted),
// so once any real business/member exists (e.g. db/seeds/dev/06_dev_fixtures.js),
// a blind `del()` here breaks every future reseed. Discovered in Phase 2.2
// when reseeding after dev fixtures already existed - report.md Phase 2 plan.
export const seed = async (knex) => {
  await knex("roles")
    .insert([
      { key: "owner", name: "Owner", is_system: true },
      { key: "staff", name: "Staff", is_system: true },
    ])
    .onConflict("key")
    .merge(["name", "is_system"]);
};
