import knex from "../../db/knex.js";

export const list = (studioId, { businessMemberId, date, from, to }, db = knex) => {
  let query = db("time_off").where({ studio_id: studioId });

  if (businessMemberId) query = query.andWhere({ business_member_id: businessMemberId });

  if (date) {
    query = query.andWhere({ date });
  } else if (from && to) {
    query = query.andWhereBetween("date", [from, to]);
  }

  return query.orderBy([{ column: "date", order: "asc" }, { column: "start_time", order: "asc", nulls: "first" }]);
};

export const create = (row, db = knex) =>
  db("time_off").insert(row).returning("*").then((rows) => rows[0]);

export const remove = (id, studioId, { businessMemberId } = {}, db = knex) => {
  let query = db("time_off").where({ id, studio_id: studioId });
  if (businessMemberId) query = query.andWhere({ business_member_id: businessMemberId });
  return query.del().returning("id");
};
