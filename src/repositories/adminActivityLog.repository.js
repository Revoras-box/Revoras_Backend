import knex from "../../db/knex.js";

export const create = (row, db = knex) => db("admin_activity_log").insert(row);

export const listRecent = (limit, db = knex) =>
  db("admin_activity_log as al")
    .leftJoin("admins as a", "al.admin_id", "a.id")
    .select("al.*", "a.name as admin_name")
    .orderBy("al.created_at", "desc")
    .limit(limit);

// Full paginated/filterable audit log (report.md Phase 2.5 plan - "Audit
// logs" and "Pagination, Search, Filters" are both named scope items, not
// just the dashboard's "last 10" widget).
export const list = async (
  { adminId, action, entityType, entityId, dateFrom, dateTo, page, limit },
  db = knex
) => {
  let query = db("admin_activity_log as al")
    .leftJoin("admins as a", "al.admin_id", "a.id")
    .select("al.*", "a.name as admin_name");
  let countQuery = db("admin_activity_log");

  if (adminId) {
    query = query.andWhere({ "al.admin_id": adminId });
    countQuery = countQuery.andWhere({ admin_id: adminId });
  }
  if (action) {
    query = query.andWhere({ "al.action": action });
    countQuery = countQuery.andWhere({ action });
  }
  if (entityType) {
    query = query.andWhere({ "al.entity_type": entityType });
    countQuery = countQuery.andWhere({ entity_type: entityType });
  }
  if (entityId) {
    query = query.andWhere({ "al.entity_id": entityId });
    countQuery = countQuery.andWhere({ entity_id: entityId });
  }
  if (dateFrom) {
    query = query.andWhere("al.created_at", ">=", dateFrom);
    countQuery = countQuery.andWhere("created_at", ">=", dateFrom);
  }
  if (dateTo) {
    query = query.andWhere("al.created_at", "<=", dateTo);
    countQuery = countQuery.andWhere("created_at", "<=", dateTo);
  }

  query = query.orderBy("al.created_at", "desc").limit(limit).offset((page - 1) * limit);

  const [rows, [{ count }]] = await Promise.all([query, countQuery.count("* as count")]);
  return { rows, total: Number(count) };
};
