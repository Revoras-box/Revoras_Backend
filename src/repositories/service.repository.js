import knex from "../../db/knex.js";

export const findActiveByIdsForStudio = (ids, studioId, db = knex) =>
  db("services")
    .whereIn("id", ids)
    .andWhere({ studio_id: studioId, is_active: true })
    .select("id", "name", "price", "duration");

const SERVICE_FIELDS = [
  "sv.id",
  "sv.studio_id",
  "sv.name",
  "sv.description",
  "sv.category_id",
  "sv.custom_category",
  "c.name as category_name",
  "c.slug as category_slug",
  "sv.price",
  "sv.duration",
  "sv.image_url",
  "sv.is_active",
  "sv.created_at",
  "sv.updated_at",
];

// Full catalog CRUD is Phase 2.2's job (report.md Phase 2 plan) - Phase 2.1
// only needed the read above, for resolving a booking's line items.
export const listForStudio = (studioId, { activeOnly } = {}, db = knex) => {
  let query = db("services as sv")
    .join("categories as c", "sv.category_id", "c.id")
    .where({ "sv.studio_id": studioId })
    .select(SERVICE_FIELDS);

  if (activeOnly) query = query.andWhere({ "sv.is_active": true });

  return query.orderBy(["c.sort_order", "sv.price"]);
};

export const findByIdForStudio = (id, studioId, db = knex) =>
  db("services as sv")
    .join("categories as c", "sv.category_id", "c.id")
    .where({ "sv.id": id, "sv.studio_id": studioId })
    .select(SERVICE_FIELDS)
    .first();

export const create = (row, db = knex) =>
  db("services").insert(row).returning("*").then((rows) => rows[0]);

export const update = (id, studioId, patch, db = knex) =>
  db("services")
    .where({ id, studio_id: studioId })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

export const setActive = (id, studioId, isActive, db = knex) =>
  db("services")
    .where({ id, studio_id: studioId })
    .update({ is_active: isActive, updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);
