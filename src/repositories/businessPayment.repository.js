import knex from "../../db/knex.js";

// Never joins in razorpay_order_id/razorpay_payment_id - report.md's "never
// expose gateway internals to the business dashboard" applies here the same
// way booking.repository.js's listForUser already keeps them out of the
// customer-facing payment_status field.
const scoped = (db, studioId, { status, from, to }) => {
  let query = db("payments as p")
    .join("bookings as b", "p.payable_id", "b.id")
    .where("p.payable_type", "booking")
    .andWhere("b.studio_id", studioId);

  if (status) query = query.andWhere("p.status", status);
  if (from) query = query.andWhere(knex.raw("p.created_at::date"), ">=", from);
  if (to) query = query.andWhere(knex.raw("p.created_at::date"), "<=", to);

  return query;
};

export const listForStudio = async (studioId, { status, from, to, page, limit }, db = knex) => {
  const rows = await scoped(db, studioId, { status, from, to })
    .join("users as u", "b.user_id", "u.id")
    .select(
      "p.id",
      "p.amount",
      "p.currency",
      "p.status",
      "p.verified_at",
      "p.created_at",
      "b.id as booking_id",
      "b.booking_date",
      "b.confirmation_code",
      "u.name as customer_name"
    )
    .orderBy("p.created_at", "desc")
    .limit(limit)
    .offset((page - 1) * limit);

  const [{ count }] = await scoped(db, studioId, { status, from, to }).count("p.id as count");

  return { rows, total: Number(count) };
};

export const summaryForStudio = (studioId, db = knex) =>
  db("payments as p")
    .join("bookings as b", "p.payable_id", "b.id")
    .where("p.payable_type", "booking")
    .andWhere("b.studio_id", studioId)
    .select(
      db.raw("coalesce(sum(case when p.status = 'paid' then p.amount else 0 end), 0) as total_paid"),
      db.raw("coalesce(sum(case when p.status = 'refunded' then p.amount else 0 end), 0) as total_refunded"),
      db.raw("coalesce(sum(case when p.status = 'pending' then p.amount else 0 end), 0) as total_pending"),
      db.raw("count(*) as total_count")
    )
    .first();
