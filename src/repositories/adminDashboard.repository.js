import knex from "../../db/knex.js";

export const getBusinessStatusCounts = (db = knex) =>
  db("businesses")
    .select(
      db.raw("count(*) filter (where approval_status = 'pending') as pending"),
      db.raw("count(*) filter (where approval_status = 'approved') as approved"),
      db.raw("count(*) filter (where approval_status = 'rejected') as rejected"),
      db.raw("count(*) filter (where approval_status = 'suspended') as suspended"),
      db.raw("count(*) as total")
    )
    .first();

export const getActiveUserCount = async (db = knex) => {
  const row = await db("users").where({ is_active: true }).count("* as count").first();
  return Number(row.count);
};

export const getBookingStats = (sinceDate, db = knex) =>
  db("bookings")
    .where("booking_date", ">=", sinceDate)
    .select(
      db.raw("count(*) as total"),
      db.raw("count(*) filter (where status = 'completed') as completed"),
      db.raw("count(*) filter (where status in ('pending', 'confirmed')) as upcoming"),
      db.raw("coalesce(sum(total_amount) filter (where status = 'completed'), 0) as revenue")
    )
    .first();

export const getRecentPendingBusinesses = (limit, db = knex) =>
  db("businesses").where({ approval_status: "pending" }).select("id", "name", "city", "state", "created_at").orderBy("created_at", "desc").limit(limit);
