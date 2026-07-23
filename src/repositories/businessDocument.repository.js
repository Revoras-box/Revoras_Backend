import knex from "../../db/knex.js";

const FIELDS = ["id", "studio_id", "doc_type", "url", "original_name", "created_at"];

export const list = (studioId, db = knex) =>
  db("business_documents").where({ studio_id: studioId }).select(FIELDS).orderBy("created_at", "asc");

export const count = (studioId, db = knex) =>
  db("business_documents")
    .where({ studio_id: studioId })
    .count("* as count")
    .first()
    .then((row) => Number(row.count));

export const findById = (id, studioId, db = knex) =>
  db("business_documents").where({ id, studio_id: studioId }).select(FIELDS).first();

export const create = (row, db = knex) =>
  db("business_documents").insert(row).returning(FIELDS).then((rows) => rows[0]);

export const remove = (id, studioId, db = knex) => db("business_documents").where({ id, studio_id: studioId }).del();
