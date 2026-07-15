import knex from "../../db/knex.js";

const PROFILE_FIELDS = [
  "id",
  "name",
  "slug",
  "category_id",
  "address",
  "city",
  "state",
  "zip_code",
  "country",
  "lat",
  "lng",
  "phone",
  "email",
  "description",
  "image_url",
  "logo_url",
  "banner_url",
  "amenities",
  "website",
  "social_links",
  "languages",
  "payment_methods",
  "policies",
  "accessibility",
  "house_rules",
  "rating",
  "review_count",
  "approval_status",
  "is_active",
  "business_status",
  "onboarding_step",
  "created_at",
  "updated_at",
];

export const runInTransaction = (work) => knex.transaction(work);

export const findRoleByKey = (key, db = knex) => db("roles").where({ key }).first();

export const create = (row, db = knex) =>
  db("businesses").insert(row).returning(PROFILE_FIELDS).then((rows) => rows[0]);

export const findById = (id, db = knex) => db("businesses").where({ id }).select(PROFILE_FIELDS).first();

export const findBySlug = (slug, db = knex) => db("businesses").where({ slug }).first();

export const update = (id, patch, db = knex) =>
  db("businesses")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(PROFILE_FIELDS)
    .then((rows) => rows[0]);

export const setActive = (id, isActive, db = knex) =>
  db("businesses").where({ id }).update({ is_active: isActive, updated_at: db.fn.now() });

// Phase 1.5a - lifecycle status read/write. `updateStatus` is written only by
// BusinessLifecycleService (it also carries the legacy approval_status/is_active
// mirror during the migration bridge).
export const findStatus = (id, db = knex) =>
  db("businesses").where({ id }).first("id", "business_status", "approval_status", "is_active");

export const updateStatus = (id, patch, db = knex) =>
  db("businesses")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(["id", "business_status", "approval_status", "is_active"])
    .then((rows) => rows[0]);

// Businesses the given user belongs to (owner or staff), for a "my businesses"
// list and for resolving memberships at business-login time (report.md Phase
// 2.3 plan) - includes role_id so the caller can compute effective permissions
// per membership without a second round trip.
export const listForUser = (userId, db = knex) =>
  db("businesses as biz")
    .join("business_members as bm", "biz.id", "bm.studio_id")
    .join("roles as r", "bm.role_id", "r.id")
    .where({ "bm.user_id": userId, "bm.status": "active" })
    .select([
      ...PROFILE_FIELDS.map((f) => `biz.${f}`),
      "bm.id as member_id",
      "bm.role_id",
      "r.key as role",
      "bm.designation",
    ]);
