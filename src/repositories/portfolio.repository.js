import knex from "../../db/knex.js";

const FIELDS = ["id", "business_member_id", "media_url", "thumbnail_url", "caption", "sort_order", "is_cover", "created_at", "updated_at"];

export const list = (memberId, db = knex) =>
  db("member_portfolio").where({ business_member_id: memberId }).select(FIELDS).orderBy("sort_order", "asc");

export const count = (memberId, db = knex) =>
  db("member_portfolio")
    .where({ business_member_id: memberId })
    .count("* as count")
    .first()
    .then((row) => Number(row.count));

export const findById = (id, memberId, db = knex) =>
  db("member_portfolio").where({ id, business_member_id: memberId }).select(FIELDS).first();

export const maxSortOrder = (memberId, db = knex) =>
  db("member_portfolio")
    .where({ business_member_id: memberId })
    .max("sort_order as max")
    .first()
    .then((row) => row.max ?? -1);

export const create = (row, db = knex) =>
  db("member_portfolio").insert(row).returning(FIELDS).then((rows) => rows[0]);

export const remove = (id, memberId, db = knex) => db("member_portfolio").where({ id, business_member_id: memberId }).del();

export const updateSortOrder = (id, memberId, sortOrder, db = knex) =>
  db("member_portfolio")
    .where({ id, business_member_id: memberId })
    .update({ sort_order: sortOrder, updated_at: db.fn.now() });

export const updateCaption = (id, memberId, caption, db = knex) =>
  db("member_portfolio")
    .where({ id, business_member_id: memberId })
    .update({ caption, updated_at: db.fn.now() })
    .returning(FIELDS)
    .then((rows) => rows[0]);

export const unsetCover = (memberId, db = knex) =>
  db("member_portfolio").where({ business_member_id: memberId, is_cover: true }).update({ is_cover: false, updated_at: db.fn.now() });

export const setCover = (id, memberId, db = knex) =>
  db("member_portfolio")
    .where({ id, business_member_id: memberId })
    .update({ is_cover: true, updated_at: db.fn.now() })
    .returning(FIELDS)
    .then((rows) => rows[0]);

export const runInTransaction = (work) => knex.transaction(work);
