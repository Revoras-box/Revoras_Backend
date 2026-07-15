import knex from "../../db/knex.js";

export const create = (row, db = knex) =>
  db("password_reset_tokens").insert(row).returning("*").then((rows) => rows[0]);

export const findValidByHash = (tokenHash, db = knex) =>
  db("password_reset_tokens")
    .where({ token_hash: tokenHash, consumed: false })
    .andWhere("expires_at", ">", db.fn.now())
    .first();

export const consume = (id, db = knex) => db("password_reset_tokens").where({ id }).update({ consumed: true });

// Invalidate any earlier unconsumed reset tokens for this user when a new one
// is requested - only the most recently requested link should ever work.
export const invalidateForUser = (userId, db = knex) =>
  db("password_reset_tokens").where({ user_id: userId, consumed: false }).update({ consumed: true });
