import knex from "../../db/knex.js";

const FIELDS = [
  "id",
  "business_member_id",
  "title",
  "issuer",
  "issued_date",
  "expiry_date",
  "credential_id",
  "verification_url",
  "media_url",
  "sort_order",
  "created_at",
  "updated_at",
];

export const list = (memberId, db = knex) =>
  db("member_certificates").where({ business_member_id: memberId }).select(FIELDS).orderBy("sort_order", "asc");

export const count = (memberId, db = knex) =>
  db("member_certificates")
    .where({ business_member_id: memberId })
    .count("* as count")
    .first()
    .then((row) => Number(row.count));

export const findById = (id, memberId, db = knex) =>
  db("member_certificates").where({ id, business_member_id: memberId }).select(FIELDS).first();

export const maxSortOrder = (memberId, db = knex) =>
  db("member_certificates")
    .where({ business_member_id: memberId })
    .max("sort_order as max")
    .first()
    .then((row) => row.max ?? -1);

export const create = (row, db = knex) =>
  db("member_certificates").insert(row).returning(FIELDS).then((rows) => rows[0]);

export const update = (id, memberId, patch, db = knex) =>
  db("member_certificates")
    .where({ id, business_member_id: memberId })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(FIELDS)
    .then((rows) => rows[0]);

export const remove = (id, memberId, db = knex) => db("member_certificates").where({ id, business_member_id: memberId }).del();
