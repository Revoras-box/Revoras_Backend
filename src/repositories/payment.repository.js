import knex from "../../db/knex.js";

export const create = (row, db = knex) =>
  db("payments").insert(row).returning("*").then((rows) => rows[0]);

export const findById = (id, db = knex) => db("payments").where({ id }).first();

export const findByRazorpayOrderId = (orderId, db = knex) =>
  db("payments").where({ razorpay_order_id: orderId }).first();

export const markPaid = (id, { razorpayPaymentId }, db = knex) =>
  db("payments")
    .where({ id })
    .andWhereNot({ status: "paid" })
    .update({
      status: "paid",
      razorpay_payment_id: razorpayPaymentId,
      verified_at: db.fn.now(),
      updated_at: db.fn.now(),
    })
    .returning("*")
    .then((rows) => rows[0]);

export const markFailed = (id, db = knex) =>
  db("payments")
    .where({ id })
    .andWhereNot({ status: "paid" })
    .update({ status: "failed", updated_at: db.fn.now() });
