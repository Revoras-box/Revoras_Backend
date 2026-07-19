import knex from "../../db/knex.js";

/**
 * Pending is derived, never stored - see the migration. Every lookup that means
 * "still usable" goes through this predicate so the definition lives in one place.
 */
const wherePending = (qb) => qb.whereNull("accepted_at").whereNull("revoked_at");

export const create = (row, db = knex) =>
  db("business_invites").insert(row).returning("*").then((rows) => rows[0]);

export const findById = (id, studioId, db = knex) =>
  db("business_invites").where({ id, studio_id: studioId }).first();

/**
 * Joined to businesses/roles because the accept screen shows the invitee who
 * invited them and as what, and they are unauthenticated at that point - they
 * cannot call the business endpoints to look it up themselves.
 */
export const findPendingByHash = (tokenHash, db = knex) =>
  db("business_invites as bi")
    .join("businesses as b", "b.id", "bi.studio_id")
    .join("roles as r", "r.id", "bi.role_id")
    .where("bi.token_hash", tokenHash)
    .modify(wherePending)
    .andWhere("bi.expires_at", ">", db.fn.now())
    .select(
      "bi.*",
      "b.name as business_name",
      "b.logo_url as business_logo_url",
      "b.city as business_city",
      "r.key as role_key"
    )
    .first();

/**
 * Columns are listed explicitly rather than `bi.*` so `token_hash` cannot ride
 * along into an API response. It is only a hash, but it is the one column in
 * this table that exists to not be handed out, and `bi.*` would leak it to
 * every caller of the invites list.
 */
export const listPending = (studioId, db = knex) =>
  db("business_invites as bi")
    .join("roles as r", "r.id", "bi.role_id")
    .leftJoin("users as u", "u.id", "bi.invited_by")
    .where("bi.studio_id", studioId)
    .modify(wherePending)
    .select(
      "bi.id",
      "bi.studio_id",
      "bi.name",
      "bi.email",
      "bi.phone",
      "bi.designation",
      "bi.provides_services",
      "bi.experience_years",
      "bi.expires_at",
      "bi.created_at",
      "r.key as role_key",
      "u.name as invited_by_name"
    )
    .orderBy("bi.created_at", "desc");

export const markAccepted = (id, userId, db = knex) =>
  db("business_invites")
    .where({ id })
    .update({ accepted_at: db.fn.now(), accepted_user_id: userId, updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

export const revoke = (id, studioId, db = knex) =>
  db("business_invites")
    .where({ id, studio_id: studioId })
    .modify(wherePending)
    .update({ revoked_at: db.fn.now(), updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

/** Used by resend: a new token invalidates the old link rather than adding a second one. */
export const rotateToken = (id, tokenHash, expiresAt, db = knex) =>
  db("business_invites")
    .where({ id })
    .update({ token_hash: tokenHash, expires_at: expiresAt, updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);
