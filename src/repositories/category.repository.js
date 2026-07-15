import knex from "../../db/knex.js";

export const list = (type, db = knex) => {
  let query = db("categories").select("id", "name", "slug", "icon", "type", "sort_order");
  if (type) query = query.where({ type });
  return query.orderBy("sort_order");
};

export const findById = (id, db = knex) => db("categories").where({ id }).first();
