import knex from "../../db/knex.js";

export const listForAdmin = async ({ search, page, limit }, db = knex) => {
  let query = db("users as u")
    .leftJoin("bookings as b", "b.user_id", "u.id")
    .select("u.id", "u.name", "u.email", "u.phone", "u.is_active", "u.created_at")
    .count("b.id as booking_count")
    .groupBy("u.id");
  let countQuery = db("users").count("* as count").first();

  if (search) {
    query = query.andWhere((qb) => qb.whereILike("u.name", `%${search}%`).orWhereILike("u.email", `%${search}%`));
    countQuery = countQuery.andWhere((qb) => qb.whereILike("name", `%${search}%`).orWhereILike("email", `%${search}%`));
  }

  query = query.orderBy("u.created_at", "desc").limit(limit).offset((page - 1) * limit);

  const [rows, countRow] = await Promise.all([query, countQuery]);
  return { rows, total: Number(countRow.count) };
};

export const setActive = (id, isActive, db = knex) =>
  db("users")
    .where({ id })
    .update({ is_active: isActive, updated_at: db.fn.now() })
    .returning(["id", "name", "email", "is_active"])
    .then((rows) => rows[0]);
