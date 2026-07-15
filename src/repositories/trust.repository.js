import knex from "../../db/knex.js";

// Booking-derived metrics in a single pass. avg_response_minutes is a proxy:
// mean minutes from booking creation to its last update for confirmed bookings
// (Revoras has no messaging layer yet - this stands in for "how fast the
// business acts on a request" and is replaced when real response data exists).
export const bookingStats = (businessId, db = knex) =>
  db("bookings")
    .where({ studio_id: businessId })
    .select(
      db.raw("count(*)::int as total"),
      db.raw("count(*) filter (where status = 'completed')::int as completed"),
      db.raw("count(*) filter (where status = 'cancelled')::int as cancelled"),
      db.raw("count(*) filter (where status = 'no_show')::int as no_show"),
      db.raw("avg(extract(epoch from (updated_at - created_at)) / 60) filter (where status = 'confirmed') as avg_response_minutes")
    )
    .first();

export const businessRow = (businessId, db = knex) =>
  db("businesses")
    .where({ id: businessId })
    .first("id", "rating", "review_count", "created_at", "description", "amenities", "languages", "payment_methods", "policies", "social_links");

export const galleryCount = (businessId, db = knex) =>
  db("business_gallery_images").where({ studio_id: businessId }).count("* as c").first().then((r) => Number(r.c));

export const activeServiceCount = (businessId, db = knex) =>
  db("services").where({ studio_id: businessId, is_active: true }).count("* as c").first().then((r) => Number(r.c));

export const activeStaffCount = (businessId, db = knex) =>
  db("business_members").where({ studio_id: businessId, status: "active" }).count("* as c").first().then((r) => Number(r.c));

export const openHoursCount = (businessId, db = knex) =>
  db("working_hours").where({ studio_id: businessId, is_closed: false }).count("* as c").first().then((r) => Number(r.c));

// Phase 1.4b: a business is "verified" iff it has an approved verification
// request. Read here (not passed in) so the trust score stays consistent no
// matter what triggers a recompute.
export const isVerified = (businessId, db = knex) =>
  db("verification_requests").where({ business_id: businessId, status: "approved" }).first("id").then((r) => !!r);

export const get = (businessId, db = knex) => db("trust_scores").where({ business_id: businessId }).first();

export const upsert = (row, db = knex) => db("trust_scores").insert(row).onConflict("business_id").merge();
