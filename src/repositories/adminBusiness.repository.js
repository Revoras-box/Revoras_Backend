import knex from "../../db/knex.js";

/**
 * Admin's cross-business view - deliberately separate from business.repository.js
 * (report.md Phase 2.5 plan: "keep Admin isolated from the Business permission
 * model"). Returns moderation-only fields (approved_by, rejection_reason,
 * admin_notes, ...) that a business's own self-service view never exposes,
 * and can list/filter across every business on the platform regardless of
 * membership.
 */

const VALID_SORT_COLUMNS = ["created_at", "name", "rating", "approval_status"];

const joinOwner = (query, ownerRoleId) =>
  query
    .leftJoin("business_members as bm", function () {
      this.on("bm.studio_id", "=", "biz.id").andOn("bm.role_id", "=", knex.raw("?", [ownerRoleId]));
    })
    .leftJoin("users as owner", "bm.user_id", "owner.id");

export const listForAdmin = async ({ status, search, page, limit, sortBy, sortOrder }, db = knex) => {
  const ownerRole = await db("roles").where({ key: "owner" }).first();

  let query = joinOwner(db("businesses as biz"), ownerRole.id).leftJoin("bookings as b", "b.studio_id", "biz.id");
  let countQuery = joinOwner(db("businesses as biz"), ownerRole.id);

  const applyFilters = (qb) => {
    let result = qb;
    if (status) result = result.andWhere({ "biz.approval_status": status });
    if (search) {
      result = result.andWhere((sub) =>
        sub.whereILike("biz.name", `%${search}%`).orWhereILike("biz.city", `%${search}%`).orWhereILike("owner.email", `%${search}%`)
      );
    }
    return result;
  };

  query = applyFilters(query);
  countQuery = applyFilters(countQuery);

  const sortColumn = VALID_SORT_COLUMNS.includes(sortBy) ? sortBy : "created_at";
  const order = sortOrder === "asc" ? "asc" : "desc";

  query = query
    .groupBy("biz.id", "owner.name", "owner.email", "owner.phone")
    .select(
      "biz.*",
      "owner.name as owner_name",
      "owner.email as owner_email",
      "owner.phone as owner_phone",
      db.raw("count(distinct b.id) as booking_count")
    )
    .orderBy(`biz.${sortColumn}`, order)
    .limit(limit)
    .offset((page - 1) * limit);

  const [rows, [{ count }]] = await Promise.all([query, countQuery.countDistinct("biz.id as count")]);
  return { rows, total: Number(count) };
};

export const findByIdForAdmin = (id, db = knex) =>
  db("businesses as biz")
    .leftJoin("admins as a", "biz.approved_by", "a.id")
    .where({ "biz.id": id })
    .select("biz.*", "a.name as approved_by_name")
    .first();

export const findOwnerForBusiness = (studioId, db = knex) =>
  db("business_members as bm")
    .join("roles as r", "bm.role_id", "r.id")
    .join("users as u", "bm.user_id", "u.id")
    .where({ "bm.studio_id": studioId, "r.key": "owner" })
    .select("u.id as owner_id", "u.name as owner_name", "u.email as owner_email", "u.phone as owner_phone", "bm.joined_at as owner_since")
    .first();

export const findAddressInfo = (id, db = knex) =>
  db("businesses").where({ id }).select("address", "city", "state", "country", "lat", "lng").first();

export const update = (id, patch, db = knex) =>
  db("businesses")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

export const setLatLng = (id, { lat, lng }, db = knex) =>
  db("businesses")
    .where({ id })
    .update({ lat, lng, updated_at: db.fn.now() })
    .returning(["id", "lat", "lng"])
    .then((rows) => rows[0]);
