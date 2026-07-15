import knex from "../../db/knex.js";

const FIELDS = ["id", "studio_id", "url", "sort_order", "is_cover", "created_at"];

export const list = (studioId, db = knex) =>
  db("business_gallery_images").where({ studio_id: studioId }).select(FIELDS).orderBy("sort_order", "asc");

export const count = (studioId, db = knex) =>
  db("business_gallery_images")
    .where({ studio_id: studioId })
    .count("* as count")
    .first()
    .then((row) => Number(row.count));

export const findById = (id, studioId, db = knex) =>
  db("business_gallery_images").where({ id, studio_id: studioId }).select(FIELDS).first();

export const maxSortOrder = (studioId, db = knex) =>
  db("business_gallery_images")
    .where({ studio_id: studioId })
    .max("sort_order as max")
    .first()
    .then((row) => row.max ?? -1);

export const create = (row, db = knex) =>
  db("business_gallery_images").insert(row).returning(FIELDS).then((rows) => rows[0]);

export const remove = (id, studioId, db = knex) => db("business_gallery_images").where({ id, studio_id: studioId }).del();

export const updateSortOrder = (id, studioId, sortOrder, db = knex) =>
  db("business_gallery_images")
    .where({ id, studio_id: studioId })
    .update({ sort_order: sortOrder, updated_at: db.fn.now() });

export const unsetCover = (studioId, db = knex) =>
  db("business_gallery_images").where({ studio_id: studioId, is_cover: true }).update({ is_cover: false, updated_at: db.fn.now() });

export const setCover = (id, studioId, db = knex) =>
  db("business_gallery_images")
    .where({ id, studio_id: studioId })
    .update({ is_cover: true, updated_at: db.fn.now() })
    .returning(FIELDS)
    .then((rows) => rows[0]);

export const runInTransaction = (work) => knex.transaction(work);
