import knex from "../../db/knex.js";

const FAVORITE_FIELDS = [
  "biz.id",
  "biz.name",
  "biz.slug",
  "biz.image_url",
  "biz.rating",
  "biz.review_count",
  "biz.city",
  "biz.address",
  "f.created_at as favorited_at",
];

// Phase 2.3 - a favorited professional's card shape. Mirrors
// discovery.repository.js's listProfessionalsForBusiness select (same columns,
// name off `users`) so the Saved page renders through the same ProfessionalCard
// mapping the rest of the app already uses.
const FAVORITE_PROFESSIONAL_FIELDS = [
  "bm.id",
  "bm.designation",
  "bm.specialties",
  "bm.experience_years",
  "bm.rating",
  "bm.image_url",
  "u.name",
  "biz.id as business_id",
  "biz.name as business_name",
  "f.created_at as favorited_at",
];

export const listForUser = (userId, db = knex) =>
  db("favorites as f")
    .join("businesses as biz", "f.studio_id", "biz.id")
    .where({ "f.user_id": userId })
    .select(FAVORITE_FIELDS)
    .orderBy("f.created_at", "desc");

export const listProfessionalsForUser = (userId, db = knex) =>
  db("favorites as f")
    .join("business_members as bm", "f.business_member_id", "bm.id")
    .join("users as u", "bm.user_id", "u.id")
    .join("businesses as biz", "bm.studio_id", "biz.id")
    .where({ "f.user_id": userId })
    .select(FAVORITE_PROFESSIONAL_FIELDS)
    .orderBy("f.created_at", "desc");

export const findOne = (userId, studioId, db = knex) =>
  db("favorites").where({ user_id: userId, studio_id: studioId }).first();

export const create = (userId, studioId, db = knex) =>
  db("favorites").insert({ user_id: userId, studio_id: studioId }).returning("*").then((rows) => rows[0]);

export const remove = (userId, studioId, db = knex) =>
  db("favorites").where({ user_id: userId, studio_id: studioId }).del();

export const findOneProfessional = (userId, memberId, db = knex) =>
  db("favorites").where({ user_id: userId, business_member_id: memberId }).first();

export const createProfessional = (userId, memberId, db = knex) =>
  db("favorites")
    .insert({ user_id: userId, business_member_id: memberId })
    .returning("*")
    .then((rows) => rows[0]);

export const removeProfessional = (userId, memberId, db = knex) =>
  db("favorites").where({ user_id: userId, business_member_id: memberId }).del();

/**
 * Phase 2.3 - just the ids of everything this user has favorited, nothing else.
 *
 * This is what powers the heart on every discovery card. The obvious
 * alternatives are both worse: threading `userId` through listBusinesses /
 * searchBusinesses / collection resolve to stamp an `isFavorite` onto each row
 * touches every query path in discovery for one boolean, and reusing
 * `listForUser` means shipping full business cards (name, image, rating,
 * address...) for every favorite just to decide which hearts are filled.
 *
 * Two id arrays are cheap enough to fetch once per session and let any card
 * anywhere - rails, search, collections, professional lists - answer
 * "am I favorited?" locally, which is also exactly the client-side state the
 * optimistic toggle needs to exist anyway.
 */
export const listIdsForUser = async (userId, db = knex) => {
  const rows = await db("favorites").where({ user_id: userId }).select("studio_id", "business_member_id");
  return {
    studioIds: rows.filter((r) => r.studio_id).map((r) => r.studio_id),
    memberIds: rows.filter((r) => r.business_member_id).map((r) => r.business_member_id),
  };
};
