import knex from "../../db/knex.js";

/**
 * "Customers" isn't a real table - a business's customer list is derived
 * from its booking history (report.md has no customers concept; this is a
 * purely additive, read-only aggregation over bookings + users). Cancelled
 * bookings are excluded (they represent no visit); total_spent only counts
 * completed bookings, matching dashboard.repository.js's revenueSummary
 * convention for what counts as "revenue".
 */
const scoped = (db, studioId, search) => {
  let query = db("bookings as b")
    .join("users as u", "b.user_id", "u.id")
    .where("b.studio_id", studioId)
    .whereNot("b.status", "cancelled");

  if (search) {
    query = query.andWhere((qb) => qb.whereILike("u.name", `%${search}%`).orWhereILike("u.phone", `%${search}%`));
  }

  return query;
};

export const listForStudio = async (studioId, { search, page, limit }, db = knex) => {
  const rows = await scoped(db, studioId, search)
    .groupBy("u.id")
    .select(
      "u.id",
      "u.name",
      "u.phone",
      "u.avatar_url as image_url",
      db.raw("count(*) as visits_count"),
      db.raw("coalesce(sum(case when b.status = 'completed' then b.total_amount else 0 end), 0) as total_spent"),
      db.raw("min(b.booking_date) as first_visit"),
      db.raw("max(b.booking_date) as last_visit")
    )
    .orderBy("last_visit", "desc")
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ count }] = await scoped(db, studioId, search).countDistinct("u.id as count");

  return { rows, total: Number(count) };
};

export const bookingHistoryForCustomer = async (studioId, userId, { page, limit }, db = knex) => {
  const rowsQuery = db("bookings as b")
    .join("business_members as bm", "b.business_member_id", "bm.id")
    .join("users as u2", "bm.user_id", "u2.id")
    .leftJoin("payments as p", "b.payment_id", "p.id")
    .where({ "b.studio_id": studioId, "b.user_id": userId })
    .select(
      "b.id",
      "b.status",
      "b.booking_date",
      "b.start_time",
      "b.end_time",
      "b.total_amount",
      "b.confirmation_code",
      db.raw("coalesce(p.status, 'unpaid') as payment_status"),
      "u2.name as member_name",
      "bm.designation as member_designation"
    )
    .orderBy("b.booking_date", "desc")
    .limit(limit)
    .offset((page - 1) * limit);

  const countQuery = db("bookings").where({ studio_id: studioId, user_id: userId }).count("* as count").first();

  const [rows, countRow] = await Promise.all([rowsQuery, countQuery]);
  return { rows, total: Number(countRow.count) };
};
