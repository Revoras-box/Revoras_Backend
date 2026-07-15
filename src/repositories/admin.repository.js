import knex from "../../db/knex.js";

/**
 * `admins` is a deliberately separate table/identity from `users` (report.md
 * §2.0/Phase 2.5 plan - "keep Admin isolated from the Business permission
 * model"). Simple two-tier `role` check (admin/super_admin), not the
 * role_permissions/business_member_permission_overrides system the Business
 * side uses - that's intentional, not an oversight.
 */

const ADMIN_SAFE_FIELDS = ["id", "name", "email", "role", "is_active", "last_login", "created_at", "updated_at"];

export const findByEmail = (email, db = knex) => db("admins").where({ email }).first();

export const findById = (id, db = knex) => db("admins").where({ id }).first();

export const findProfileById = (id, db = knex) => db("admins").where({ id }).select(ADMIN_SAFE_FIELDS).first();

export const updateLastLogin = (id, db = knex) => db("admins").where({ id }).update({ last_login: db.fn.now() });

export const create = (row, db = knex) =>
  db("admins").insert(row).returning(ADMIN_SAFE_FIELDS).then((rows) => rows[0]);

export const listAll = (db = knex) => db("admins").select(ADMIN_SAFE_FIELDS).orderBy("created_at", "desc");
