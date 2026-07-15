import knex from "../../db/knex.js";

// Mirrors favorite.repository.js's card shapes - the Recently Viewed rail and
// the Saved rail render through the same BusinessCard/ProfessionalCard mapping,
// so they must return the same columns.
const VIEWED_BUSINESS_FIELDS = [
  "biz.id",
  "biz.name",
  "biz.slug",
  "biz.image_url",
  "biz.rating",
  "biz.review_count",
  "biz.city",
  "biz.address",
  "rv.viewed_at",
];

const VIEWED_PROFESSIONAL_FIELDS = [
  "bm.id",
  "bm.designation",
  "bm.specialties",
  "bm.experience_years",
  "bm.rating",
  "bm.image_url",
  "u.name",
  "biz.id as business_id",
  "biz.name as business_name",
  "rv.viewed_at",
];

/**
 * Phase 2.3 - dedup is the unique index doing the work, not app code: one row
 * per (user, target), and a repeat view just moves `viewed_at` forward. Doing
 * it any other way (insert-then-prune) races with itself on a double-click or
 * a second tab and forces every read to dedup in JS.
 */
export const recordBusinessView = (userId, studioId, db = knex) =>
  db("recently_viewed")
    .insert({ user_id: userId, studio_id: studioId })
    .onConflict(["user_id", "studio_id"])
    .merge({ viewed_at: db.fn.now() });

export const recordProfessionalView = (userId, memberId, db = knex) =>
  db("recently_viewed")
    .insert({ user_id: userId, business_member_id: memberId })
    .onConflict(["user_id", "business_member_id"])
    .merge({ viewed_at: db.fn.now() });

export const listBusinessesForUser = (userId, limit, db = knex) =>
  db("recently_viewed as rv")
    .join("businesses as biz", "rv.studio_id", "biz.id")
    // A business that has since been de-listed shouldn't resurface in a rail
    // the customer can click - discovery filters on exactly this pair.
    .where({ "rv.user_id": userId, "biz.approval_status": "approved", "biz.is_active": true })
    .select(VIEWED_BUSINESS_FIELDS)
    .orderBy("rv.viewed_at", "desc")
    .limit(limit);

export const listProfessionalsForUser = (userId, limit, db = knex) =>
  db("recently_viewed as rv")
    .join("business_members as bm", "rv.business_member_id", "bm.id")
    .join("users as u", "bm.user_id", "u.id")
    .join("businesses as biz", "bm.studio_id", "biz.id")
    .where({ "rv.user_id": userId, "bm.status": "active", "biz.approval_status": "approved", "biz.is_active": true })
    .select(VIEWED_PROFESSIONAL_FIELDS)
    .orderBy("rv.viewed_at", "desc")
    .limit(limit);

export const clearForUser = (userId, db = knex) => db("recently_viewed").where({ user_id: userId }).del();
