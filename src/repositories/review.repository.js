import knex from "../../db/knex.js";

const REVIEW_FIELDS = [
  "r.id",
  "r.user_id",
  "r.booking_id",
  "r.studio_id",
  "r.business_member_id",
  "r.rating",
  "r.title",
  "r.comment",
  "r.photos",
  "r.helpful_count",
  "r.created_at",
  "r.updated_at",
  "u.name as customer_name",
  "u.avatar_url as customer_avatar",
];

export const create = (row, db = knex) =>
  db("reviews").insert(row).returning("*").then((rows) => rows[0]);

export const findById = (id, db = knex) => db("reviews").where({ id }).first();

export const findByIdForUser = (id, userId, db = knex) => db("reviews").where({ id, user_id: userId }).first();

export const findByBookingId = (bookingId, db = knex) => db("reviews").where({ booking_id: bookingId }).first();

export const update = (id, patch, db = knex) =>
  db("reviews")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

export const remove = (id, db = knex) => db("reviews").where({ id }).del();

export const listForBusiness = async (studioId, { rating, sortBy, page, limit }, db = knex) => {
  let query = db("reviews as r").join("users as u", "r.user_id", "u.id").where({ "r.studio_id": studioId }).select(REVIEW_FIELDS);
  let countQuery = db("reviews").where({ studio_id: studioId });

  if (rating) {
    query = query.andWhere("r.rating", rating);
    countQuery = countQuery.andWhere("rating", rating);
  }

  const orderBy = {
    highest: [{ column: "r.rating", order: "desc" }, { column: "r.created_at", order: "desc" }],
    lowest: [{ column: "r.rating", order: "asc" }, { column: "r.created_at", order: "desc" }],
    helpful: [{ column: "r.helpful_count", order: "desc" }, { column: "r.created_at", order: "desc" }],
    recent: [{ column: "r.created_at", order: "desc" }],
  }[sortBy] || [{ column: "r.created_at", order: "desc" }];

  query = query.orderBy(orderBy).limit(limit).offset((page - 1) * limit);

  const [rows, [{ count }]] = await Promise.all([query, countQuery.count("* as count")]);
  return { rows, total: Number(count) };
};

export const listForMember = async (memberId, { page, limit }, db = knex) => {
  const query = db("reviews as r")
    .join("users as u", "r.user_id", "u.id")
    .where({ "r.business_member_id": memberId })
    .select(REVIEW_FIELDS)
    .orderBy("r.created_at", "desc")
    .limit(limit)
    .offset((page - 1) * limit);

  const countQuery = db("reviews").where({ business_member_id: memberId }).count("* as count");

  const [rows, [{ count }]] = await Promise.all([query, countQuery]);
  return { rows, total: Number(count) };
};

export const listForUser = async (userId, { page, limit }, db = knex) => {
  const query = db("reviews as r")
    .join("businesses as biz", "r.studio_id", "biz.id")
    .leftJoin("business_members as bm", "r.business_member_id", "bm.id")
    .where({ "r.user_id": userId })
    .select(
      "r.id",
      "r.booking_id",
      "r.studio_id",
      "r.business_member_id",
      "r.rating",
      "r.title",
      "r.comment",
      "r.photos",
      "r.helpful_count",
      "r.created_at",
      "r.updated_at",
      "biz.name as business_name",
      "biz.image_url as business_image",
      "bm.designation as professional_designation"
    )
    .orderBy("r.created_at", "desc")
    .limit(limit)
    .offset((page - 1) * limit);

  const countQuery = db("reviews").where({ user_id: userId }).count("* as count");

  const [rows, [{ count }]] = await Promise.all([query, countQuery]);
  return { rows, total: Number(count) };
};

export const getStatsForBusiness = async (studioId, db = knex) => {
  const [totals] = await db("reviews").where({ studio_id: studioId }).select(
    db.raw("count(*) as total"),
    db.raw("coalesce(avg(rating), 0) as avg_rating"),
    db.raw("count(*) filter (where rating = 5) as five_star"),
    db.raw("count(*) filter (where rating = 4) as four_star"),
    db.raw("count(*) filter (where rating = 3) as three_star"),
    db.raw("count(*) filter (where rating = 2) as two_star"),
    db.raw("count(*) filter (where rating = 1) as one_star")
  );
  return totals;
};

export const getStatsForMember = async (memberId, db = knex) => {
  const [totals] = await db("reviews")
    .where({ business_member_id: memberId })
    .select(db.raw("count(*) as total"), db.raw("coalesce(avg(rating), 0) as avg_rating"));
  return totals;
};

export const findHelpfulMark = (reviewId, userId, db = knex) =>
  db("review_helpful").where({ review_id: reviewId, user_id: userId }).first();

export const addHelpfulMark = (reviewId, userId, db = knex) =>
  db("review_helpful").insert({ review_id: reviewId, user_id: userId });

export const removeHelpfulMark = (reviewId, userId, db = knex) =>
  db("review_helpful").where({ review_id: reviewId, user_id: userId }).del();

export const incrementHelpfulCount = (reviewId, delta, db = knex) =>
  db("reviews").where({ id: reviewId }).update({ helpful_count: db.raw("greatest(0, helpful_count + ?)", [delta]) });

// Keeps businesses.rating/review_count (and business_members.rating) as
// derived aggregates in sync - recomputed from the reviews table rather than
// incremented, so it self-heals if a review is ever edited or deleted.
// COALESCE to 0 because both columns are NOT NULL and AVG()/COUNT() over
// zero rows (the last review on a business just got deleted) returns NULL.
export const recalcBusinessRating = (studioId, db = knex) =>
  db("businesses")
    .where({ id: studioId })
    .update({
      rating: db.raw("coalesce((select round(avg(rating)::numeric, 2) from reviews where studio_id = ?), 0)", [studioId]),
      review_count: db.raw("(select count(*) from reviews where studio_id = ?)", [studioId]),
      updated_at: db.fn.now(),
    });

export const recalcMemberRating = (memberId, db = knex) =>
  db("business_members")
    .where({ id: memberId })
    .update({
      rating: db.raw("coalesce((select round(avg(rating)::numeric, 2) from reviews where business_member_id = ?), 0)", [memberId]),
      updated_at: db.fn.now(),
    });
