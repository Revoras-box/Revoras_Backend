import knex from "../../db/knex.js";

export const totals = (studioId, sinceDate, db = knex) =>
  db("bookings")
    .where({ studio_id: studioId, status: "completed" })
    .andWhere("booking_date", ">=", sinceDate)
    .select(
      db.raw("count(*) as total_bookings"),
      db.raw("coalesce(sum(total_amount), 0) as total_revenue"),
      db.raw("coalesce(avg(total_amount), 0) as avg_ticket")
    )
    .first();

// granularity is a trusted internal enum (never user input) - see
// analytics.service.js's resolveGranularity, values are 'day' | 'week' | 'month'.
export const revenueOverTime = (studioId, sinceDate, granularity, db = knex) =>
  db("bookings")
    .where({ studio_id: studioId, status: "completed" })
    .andWhere("booking_date", ">=", sinceDate)
    .select(
      db.raw(`date_trunc('${granularity}', booking_date) as bucket`),
      db.raw("coalesce(sum(total_amount), 0) as revenue"),
      db.raw("count(*) as bookings_count")
    )
    .groupBy("bucket")
    .orderBy("bucket", "asc");

export const peakHours = (studioId, sinceDate, db = knex) =>
  db("bookings")
    .where({ studio_id: studioId })
    .whereNot({ status: "cancelled" })
    .andWhere("booking_date", ">=", sinceDate)
    .select(db.raw("extract(hour from start_time)::int as hour"))
    .count("* as bookings_count")
    .groupBy("hour")
    .orderBy("hour", "asc");

export const memberPerformancePage = async (studioId, sinceDate, { page, limit }, db = knex) => {
  const baseQuery = db("business_members as bm")
    .join("users as u", "bm.user_id", "u.id")
    .leftJoin("bookings as b", function joinCompletedInRange() {
      this.on("b.business_member_id", "=", "bm.id")
        .andOn("b.status", "=", knex.raw("'completed'"))
        .andOn("b.booking_date", ">=", knex.raw("?", [sinceDate]));
    })
    .where({ "bm.studio_id": studioId })
    .whereNot({ "bm.status": "invited" });

  const [rows, [{ count }]] = await Promise.all([
    baseQuery
      .clone()
      .groupBy("bm.id", "u.id")
      .select("bm.id", "bm.designation", "u.name", "bm.status")
      .count("b.id as bookings_count")
      .sum({ revenue: db.raw("coalesce(b.total_amount, 0)") })
      .orderBy("revenue", "desc")
      .limit(limit)
      .offset((page - 1) * limit),
    db("business_members").where({ studio_id: studioId }).whereNot({ status: "invited" }).count("* as count"),
  ]);

  return { rows, total: Number(count) };
};

export const reviewStats = (studioId, sinceDate, db = knex) =>
  db("reviews")
    .where({ studio_id: studioId })
    .andWhere("created_at", ">=", sinceDate)
    .select(
      db.raw("count(*) as total"),
      db.raw("coalesce(avg(rating), 0) as avg_rating"),
      db.raw("count(*) filter (where rating = 5) as five_star"),
      db.raw("count(*) filter (where rating = 4) as four_star"),
      db.raw("count(*) filter (where rating = 3) as three_star"),
      db.raw("count(*) filter (where rating = 2) as two_star"),
      db.raw("count(*) filter (where rating = 1) as one_star")
    )
    .first();
