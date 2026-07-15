import knex from "../../db/knex.js";

export const create = (row, db = knex) =>
  db("notifications").insert(row).returning("*").then((rows) => rows[0]);

export const listForUser = async (userId, { unreadOnly, page, limit }, db = knex) => {
  let query = db("notifications").where({ user_id: userId });
  let countQuery = db("notifications").where({ user_id: userId });

  if (unreadOnly) {
    query = query.whereNull("read_at");
    countQuery = countQuery.whereNull("read_at");
  }

  query = query.orderBy("created_at", "desc").limit(limit).offset((page - 1) * limit);

  const [rows, [{ count }]] = await Promise.all([query, countQuery.count("* as count")]);
  return { rows, total: Number(count) };
};

export const countUnread = async (userId, db = knex) => {
  const row = await db("notifications").where({ user_id: userId }).whereNull("read_at").count("* as count").first();
  return Number(row.count);
};

export const findByIdForUser = (id, userId, db = knex) => db("notifications").where({ id, user_id: userId }).first();

export const markRead = (id, userId, db = knex) =>
  db("notifications")
    .where({ id, user_id: userId })
    .whereNull("read_at")
    .update({ read_at: db.fn.now(), status: "read", updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

export const markAllRead = (userId, db = knex) =>
  db("notifications")
    .where({ user_id: userId })
    .whereNull("read_at")
    .update({ read_at: db.fn.now(), status: "read", updated_at: db.fn.now() });
