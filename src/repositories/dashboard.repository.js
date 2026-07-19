import knex from "../../db/knex.js";

const BOOKING_LIST_FIELDS = [
  "b.id",
  "b.status",
  "b.booking_date",
  "b.start_time",
  "b.end_time",
  "b.total_amount",
  "b.confirmation_code",
  "u.name as customer_name",
  "u.phone as customer_phone",
  "u.avatar_url as customer_image",
  "bm.id as business_member_id",
  "bm.designation as member_designation",
  "u2.name as member_name",
];

/**
 * Batch-attaches booking_services + services line items to a list of
 * bookings in one extra query (not one per booking) - same N+1 avoidance
 * pattern as booking.repository.js's findDetailForUser, just applied to a
 * list instead of a single row.
 */
const attachServices = async (bookings, db) => {
  if (bookings.length === 0) return bookings;

  const bookingIds = bookings.map((b) => b.id);
  const rows = await db("booking_services as bs")
    .join("services as sv", "bs.service_id", "sv.id")
    .whereIn("bs.booking_id", bookingIds)
    .select("bs.booking_id", "sv.name", "bs.price", "bs.duration");

  const byBookingId = new Map();
  for (const row of rows) {
    const list = byBookingId.get(row.booking_id) || [];
    list.push({ name: row.name, price: row.price, duration: row.duration });
    byBookingId.set(row.booking_id, list);
  }

  return bookings.map((b) => ({ ...b, services: byBookingId.get(b.id) || [] }));
};

export const todaysBookings = async (studioId, today, db = knex) => {
  const bookings = await db("bookings as b")
    .join("users as u", "b.user_id", "u.id")
    .join("business_members as bm", "b.business_member_id", "bm.id")
    .join("users as u2", "bm.user_id", "u2.id")
    .where({ "b.studio_id": studioId, "b.booking_date": today })
    .whereNot({ "b.status": "cancelled" })
    .select(BOOKING_LIST_FIELDS)
    .orderBy("b.start_time", "asc");

  return attachServices(bookings, db);
};

export const upcomingBookings = async (studioId, { today, currentTime, limit = 10 }, db = knex) => {
  const bookings = await db("bookings as b")
    .join("users as u", "b.user_id", "u.id")
    .join("business_members as bm", "b.business_member_id", "bm.id")
    .join("users as u2", "bm.user_id", "u2.id")
    .where({ "b.studio_id": studioId })
    .whereNotIn("b.status", ["cancelled", "completed", "no_show"])
    .andWhere((qb) =>
      qb.where("b.booking_date", ">", today).orWhere((qb2) => qb2.where("b.booking_date", today).andWhere("b.start_time", ">", currentTime))
    )
    .select(BOOKING_LIST_FIELDS)
    .orderBy([{ column: "b.booking_date", order: "asc" }, { column: "b.start_time", order: "asc" }])
    .limit(limit);

  return attachServices(bookings, db);
};

export const revenueSummary = (studioId, { today, weekStart, lastWeekStart }, db = knex) =>
  db("bookings")
    .where({ studio_id: studioId })
    .whereNot({ status: "cancelled" })
    .select(
      db.raw("coalesce(sum(case when booking_date = ? then total_amount end), 0) as today_revenue", [today]),
      db.raw("count(case when booking_date = ? then 1 end) as today_count", [today]),
      db.raw(
        "coalesce(sum(case when booking_date >= ? and status = 'completed' then total_amount end), 0) as week_revenue",
        [weekStart]
      ),
      db.raw("count(case when booking_date >= ? and status = 'completed' then 1 end) as week_count", [weekStart]),
      db.raw(
        "coalesce(sum(case when booking_date >= ? and booking_date < ? and status = 'completed' then total_amount end), 0) as last_week_revenue",
        [lastWeekStart, weekStart]
      )
    )
    .first();

export const popularServices = (studioId, { sinceDate, limit = 5 }, db = knex) =>
  db("booking_services as bs")
    .join("services as sv", "bs.service_id", "sv.id")
    .join("bookings as b", "bs.booking_id", "b.id")
    .where({ "b.studio_id": studioId, "b.status": "completed" })
    .andWhere("b.booking_date", ">=", sinceDate)
    .groupBy("sv.id", "sv.name")
    .select("sv.id", "sv.name")
    .count("* as bookings_count")
    .sum("bs.price as revenue")
    .orderBy("revenue", "desc")
    .limit(limit);

export const activeProfessionals = (studioId, today, db = knex) =>
  db("business_members as bm")
    .join("users as u", "bm.user_id", "u.id")
    .leftJoin("bookings as b", function joinTodayBookings() {
      this.on("b.business_member_id", "=", "bm.id")
        .andOn("b.booking_date", "=", knex.raw("?", [today]))
        .andOn(knex.raw("b.status not in ('cancelled', 'no_show')"));
    })
    .where({ "bm.studio_id": studioId, "bm.status": "active", "bm.provides_services": true })
    .groupBy("bm.id", "u.id")
    .select("bm.id", "bm.designation", "bm.rating", "bm.image_url", "u.name")
    .count("b.id as today_bookings_count")
    .orderBy("u.name");

export const bookingStatusCounts = (studioId, sinceDate, db = knex) =>
  db("bookings")
    .where({ studio_id: studioId })
    .andWhere("booking_date", ">=", sinceDate)
    .groupBy("status")
    .select("status")
    .count("* as count");

// Distinct customers whose EARLIEST booking with this business falls within
// the window - "new" means first-time, not merely "booked recently".
export const newCustomersCount = async (studioId, sinceDate, db = knex) => {
  const rows = await db("bookings")
    .where({ studio_id: studioId })
    .groupBy("user_id")
    .havingRaw("min(booking_date) >= ?", [sinceDate])
    .select("user_id");
  return rows.length;
};

export const averageRating = (studioId, db = knex) =>
  db("reviews").where({ studio_id: studioId }).avg("rating as avg_rating").first();

/**
 * Reviews the business hasn't replied to yet. Presence of `reply` is the state
 * (see the add_review_replies migration) and idx_reviews_awaiting_reply covers
 * exactly this predicate.
 */
export const reviewsAwaitingReply = (studioId, db = knex) =>
  db("reviews").where({ studio_id: studioId }).whereNull("reply").count("* as count").first();
