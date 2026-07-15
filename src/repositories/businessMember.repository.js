import knex from "../../db/knex.js";

/**
 * Full business-member CRUD lives here as of Phase 2.2 (report.md Phase 2
 * plan) - "invite" (§ businessMember.service.js) links an *existing* user by
 * email rather than creating one, since account creation is Phase 2.3's job.
 */

// Includes the role KEY (not just role_id) - the one thing today's business-
// side routes need to distinguish owner vs staff without full permission-key
// authorization, which is Phase 2.3's job (report.md Phase 2 plan).
export const findActiveMembership = ({ userId, studioId }, db = knex) =>
  db("business_members as bm")
    .join("roles as r", "bm.role_id", "r.id")
    .where({ "bm.user_id": userId, "bm.studio_id": studioId, "bm.status": "active" })
    .select("bm.*", "r.key as role")
    .first();

export const findById = (id, db = knex) => db("business_members").where({ id }).first();

// A "Professional" per report.md §2.1 - an active member who can be booked.
export const findBookableMember = ({ id, studioId }, db = knex) =>
  db("business_members")
    .where({ id, studio_id: studioId, status: "active", provides_services: true })
    .first();

const MEMBER_FIELDS = [
  "bm.id",
  "bm.studio_id",
  "bm.user_id",
  "bm.role_id",
  "r.key as role",
  "bm.designation",
  "bm.provides_services",
  "bm.specialties",
  "bm.experience_years",
  "bm.rating",
  "bm.image_url",
  "bm.bio",
  "bm.languages",
  "bm.education",
  "bm.awards",
  "bm.social_links",
  "bm.featured_service_ids",
  "bm.status",
  "bm.joined_at",
  "bm.left_at",
  "u.name",
  "u.email",
  "u.phone",
  "u.avatar_url",
];

export const listForStudio = (studioId, db = knex) =>
  db("business_members as bm")
    .join("roles as r", "bm.role_id", "r.id")
    .join("users as u", "bm.user_id", "u.id")
    .where({ "bm.studio_id": studioId })
    .whereNot({ "bm.status": "invited" })
    .select(MEMBER_FIELDS)
    .orderBy("bm.joined_at", "asc");

export const findByIdForStudio = (id, studioId, db = knex) =>
  db("business_members as bm")
    .join("roles as r", "bm.role_id", "r.id")
    .join("users as u", "bm.user_id", "u.id")
    .where({ "bm.id": id, "bm.studio_id": studioId })
    .select(MEMBER_FIELDS)
    .first();

export const findByStudioAndUser = (studioId, userId, db = knex) =>
  db("business_members").where({ studio_id: studioId, user_id: userId }).first();

export const create = (row, db = knex) =>
  db("business_members").insert(row).returning("*").then((rows) => rows[0]);

export const update = (id, patch, db = knex) =>
  db("business_members")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

export const softRemove = (id, db = knex) =>
  db("business_members")
    .where({ id })
    .update({ status: "inactive", left_at: db.fn.now(), updated_at: db.fn.now() });

// Used to guard "don't remove/demote the last owner of a business."
export const countActiveOwners = async (studioId, db = knex) => {
  const row = await db("business_members as bm")
    .join("roles as r", "bm.role_id", "r.id")
    .where({ "bm.studio_id": studioId, "bm.status": "active", "r.key": "owner" })
    .count("* as count")
    .first();
  return Number(row.count);
};

export const countActiveByStudio = async (studioId, db = knex) => {
  const row = await db("business_members").where({ studio_id: studioId, status: "active" }).count("* as count").first();
  return Number(row.count);
};
