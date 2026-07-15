import knex from "../../db/knex.js";

// Base grants for a role (report.md §3.2 - DB-driven, no hardcoded role strings).
export const listPermissionKeysForRole = async (roleId, db = knex) => {
  const rows = await db("role_permissions as rp")
    .join("permissions as p", "rp.permission_id", "p.id")
    .where({ "rp.role_id": roleId })
    .select("p.key");
  return rows.map((r) => r.key);
};

// Per-member exceptions layered on top of the role's defaults - `granted`
// true ADDS a permission the role doesn't have, false REVOKES one it does.
export const listOverridesForMember = async (businessMemberId, db = knex) => {
  const rows = await db("business_member_permission_overrides as o")
    .join("permissions as p", "o.permission_id", "p.id")
    .where({ "o.business_member_id": businessMemberId })
    .select("p.key", "o.granted");
  return rows;
};

export const listAllPermissions = (db = knex) => db("permissions").select("id", "key", "description").orderBy("key");

export const findPermissionByKey = (key, db = knex) => db("permissions").where({ key }).first();
