import knex from "../../db/knex.js";

export const getTotals = (sinceDate, db = knex) =>
  db("bookings")
    .where({ status: "completed" })
    .andWhere("booking_date", ">=", sinceDate)
    .select(db.raw("count(*) as total_bookings"), db.raw("coalesce(sum(total_amount), 0) as total_revenue"))
    .first();

// granularity is a trusted internal enum ('day'|'week'|'month'), never user
// input - see adminAnalytics.service.js's resolveGranularity.
export const getBusinessGrowth = (sinceDate, granularity, db = knex) =>
  db("businesses")
    .where("created_at", ">=", sinceDate)
    .select(db.raw(`date_trunc('${granularity}', created_at) as bucket`), db.raw("count(*) as count"))
    .groupBy("bucket")
    .orderBy("bucket", "asc");

export const getUserGrowth = (sinceDate, granularity, db = knex) =>
  db("users")
    .where("created_at", ">=", sinceDate)
    .select(db.raw(`date_trunc('${granularity}', created_at) as bucket`), db.raw("count(*) as count"))
    .groupBy("bucket")
    .orderBy("bucket", "asc");

export const getRevenueOverTime = (sinceDate, granularity, db = knex) =>
  db("bookings")
    .where({ status: "completed" })
    .andWhere("booking_date", ">=", sinceDate)
    .select(db.raw(`date_trunc('${granularity}', booking_date) as bucket`), db.raw("coalesce(sum(total_amount), 0) as revenue"))
    .groupBy("bucket")
    .orderBy("bucket", "asc");

export const getTopBusinesses = (sinceDate, limit, db = knex) =>
  db("bookings as b")
    .join("businesses as biz", "b.studio_id", "biz.id")
    .where({ "b.status": "completed" })
    .andWhere("b.booking_date", ">=", sinceDate)
    .groupBy("biz.id", "biz.name")
    .select("biz.id", "biz.name")
    .count("b.id as bookings_count")
    .sum({ revenue: "b.total_amount" })
    .orderBy("revenue", "desc")
    .limit(limit);

export const getCategoryBreakdown = (db = knex) =>
  db("businesses as biz")
    .join("categories as c", "biz.category_id", "c.id")
    .where({ "biz.approval_status": "approved" })
    .groupBy("c.id", "c.name")
    .select("c.name as category_name")
    .count("biz.id as business_count")
    .orderBy("business_count", "desc");
