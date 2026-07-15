import knex from "../../db/knex.js";

export const create = (row, db = knex) =>
  db("business_subscriptions").insert(row).returning("*").then((rows) => rows[0]);

export const findById = (id, db = knex) => db("business_subscriptions").where({ id }).first();

// Most-recent-first: history[0] doubles as "current subscription" without a
// second query - a business only ever has one subscription lineage.
export const listForBusiness = (businessId, db = knex) =>
  db("business_subscriptions").where({ business_id: businessId }).orderBy("created_at", "desc");

export const markActive = (id, { currentPeriodStart, currentPeriodEnd }, db = knex) =>
  db("business_subscriptions")
    .where({ id })
    .update({
      status: "active",
      current_period_start: currentPeriodStart,
      current_period_end: currentPeriodEnd,
      updated_at: db.fn.now(),
    })
    .returning("*")
    .then((rows) => rows[0]);
