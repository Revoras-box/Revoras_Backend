import knex from "../../db/knex.js";

// Half-open interval overlap: [startA, endA) intersects [startB, endB)
const rangesOverlap = (startA, endA, startB, endB) => startA < endB && startB < endA;

const timeToMinutes = (timeValue) => {
  if (!timeValue) return null;
  const [hourRaw, minuteRaw] = String(timeValue).split(":");
  const hours = Number(hourRaw);
  const minutes = Number(minuteRaw);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
};

export const runInTransaction = (work) => knex.transaction(work);

/**
 * Serializes concurrent booking attempts for the same professional so two
 * simultaneous requests for an overlapping slot can't both pass the conflict
 * check before either commits. Backstopped by the `excl_bookings_no_overlap`
 * EXCLUDE constraint on `bookings` (report.md §3.5) in case this check is
 * ever bypassed by a bug - see insertBooking's exclusion-violation handling.
 */
export const acquireMemberLock = (trx, businessMemberId) =>
  trx.raw("SELECT pg_advisory_xact_lock(hashtext(?))", [String(businessMemberId)]);

export const findConflict = async (
  trx,
  { businessMemberId, date, startTime, endTime, excludeBookingId }
) => {
  const newStart = timeToMinutes(startTime);
  const newEnd = timeToMinutes(endTime);

  // Only `cancelled` frees a slot - exactly what `excl_bookings_no_overlap`
  // excludes. `completed` used to be treated as free here too, which let the
  // pre-check pass a booking the DB constraint then rejected: mark an 11:00
  // appointment complete when the customer leaves early, and the next 11:00
  // request sailed through this check only to die on a 23P01 backstop. The two
  // layers must agree on what "occupied" means or availability lies.
  let bookingQuery = trx("bookings")
    .where({ business_member_id: businessMemberId, booking_date: date })
    .whereNot("status", "cancelled")
    .select("id", "start_time", "end_time");

  if (excludeBookingId) {
    bookingQuery = bookingQuery.whereNot({ id: excludeBookingId });
  }

  const [bookingRows, blockRows] = await Promise.all([
    bookingQuery,
    trx("time_off")
      .where({ business_member_id: businessMemberId, date })
      .select("start_time", "end_time", "is_full_day"),
  ]);

  const hasBookingConflict = bookingRows.some((row) => {
    const existingStart = timeToMinutes(row.start_time);
    const existingEnd = timeToMinutes(row.end_time);
    if (existingStart === null || existingEnd === null) return false;
    return rangesOverlap(newStart, newEnd, existingStart, existingEnd);
  });
  if (hasBookingConflict) return { conflict: true, reason: "booking" };

  const hasBlockConflict = blockRows.some((row) => {
    if (row.is_full_day) return true;
    const blockedStart = timeToMinutes(row.start_time);
    const blockedEnd = timeToMinutes(row.end_time);
    if (blockedStart === null || blockedEnd === null) return false;
    return rangesOverlap(newStart, newEnd, blockedStart, blockedEnd);
  });
  if (hasBlockConflict) return { conflict: true, reason: "blocked" };

  return { conflict: false };
};

export const insertBooking = (trx, row) =>
  trx("bookings").insert(row).returning("*").then((rows) => rows[0]);

export const insertBookingServices = (trx, rows) => trx("booking_services").insert(rows);

export const setConfirmationCode = (trx, bookingId, code) =>
  trx("bookings")
    .where({ id: bookingId })
    .update({ confirmation_code: code, updated_at: trx.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

export const setPaymentId = (trx, bookingId, paymentId) =>
  trx("bookings").where({ id: bookingId }).update({ payment_id: paymentId, updated_at: trx.fn.now() });

export const confirmIfPending = (trx, bookingId) =>
  trx("bookings")
    .where({ id: bookingId, status: "pending" })
    .update({ status: "confirmed", updated_at: trx.fn.now() });

export const findByIdForUser = (id, userId, db = knex) =>
  db("bookings").where({ id, user_id: userId }).first();

export const findById = (id, db = knex) => db("bookings").where({ id }).first();


export const updateReschedule = (trx, id, { date, startTime, endTime }) =>
  trx("bookings")
    .where({ id })
    .update({
      booking_date: date,
      start_time: startTime,
      end_time: endTime,
      updated_at: trx.fn.now(),
    });

// "upcoming"/"past"/"cancelled" per report.md Phase 2.4 plan's customer
// booking API shape. Compared against the DB's own CURRENT_DATE/CURRENT_TIME
// rather than a JS-computed date string, so it can't drift from whatever
// timezone Postgres itself is running in.
const CATEGORY_CONDITIONS = {
  upcoming: (prefix) =>
    `(${prefix}booking_date > current_date or (${prefix}booking_date = current_date and ${prefix}start_time >= current_time))
     and ${prefix}status not in ('cancelled', 'completed', 'no_show')`,
  past: (prefix) =>
    `(${prefix}booking_date < current_date or (${prefix}booking_date = current_date and ${prefix}start_time < current_time) or ${prefix}status in ('completed', 'no_show'))
     and ${prefix}status <> 'cancelled'`,
  cancelled: (prefix) => `${prefix}status = 'cancelled'`,
};

export const listForUser = async (userId, { status, category, page, limit }, db = knex) => {
  let query = db("bookings as b")
    .join("businesses as biz", "b.studio_id", "biz.id")
    .join("business_members as bm", "b.business_member_id", "bm.id")
    .join("users as u2", "bm.user_id", "u2.id")
    .leftJoin("payments as p", "b.payment_id", "p.id")
    .where("b.user_id", userId)
    .select(
      "b.id",
      "b.studio_id",
      "b.business_member_id",
      "b.booking_date",
      "b.start_time",
      "b.end_time",
      "b.total_amount",
      "b.total_duration",
      "b.notes",
      "b.status",
      "b.confirmation_code",
      "b.cancellation_reason",
      "b.cancelled_at",
      "b.created_at",
      "b.updated_at",
      // Friendly payment state only - never the raw gateway fields
      // (razorpay_order_id/razorpay_payment_id live only in `payments` and
      // are never selected here, report.md Phase 2.4 plan).
      db.raw("coalesce(p.status, 'unpaid') as payment_status"),
      "biz.name as studio_name",
      "biz.address as studio_address",
      "biz.image_url as studio_image",
      // The customer sees who they booked with by NAME; designation alone
      // ("Senior Stylist") is a job title, not a person. bm.user_id is
      // NOT NULL, so this inner join can't drop a booking from the list.
      "u2.name as member_name",
      "bm.designation as member_designation",
      "bm.image_url as member_image"
    );

  let countQuery = db("bookings").where({ user_id: userId });

  if (status) {
    const statusValues = String(status).split(",").map((s) => s.trim()).filter(Boolean);
    if (statusValues.length === 1) {
      query = query.andWhere("b.status", statusValues[0]);
      countQuery = countQuery.andWhere("status", statusValues[0]);
    } else if (statusValues.length > 1) {
      query = query.andWhere("b.status", "in", statusValues);
      countQuery = countQuery.andWhere("status", "in", statusValues);
    }
  }

  if (category && CATEGORY_CONDITIONS[category]) {
    query = query.andWhereRaw(CATEGORY_CONDITIONS[category]("b."));
    countQuery = countQuery.andWhereRaw(CATEGORY_CONDITIONS[category](""));
  }

  query = query
    .orderBy("b.booking_date", "desc")
    .orderBy("b.start_time", "desc")
    .limit(limit)
    .offset((page - 1) * limit);

  const [rows, [{ count }]] = await Promise.all([query, countQuery.count("* as count")]);

  return { rows, total: Number(count) };
};

export const findDetailForUser = async (id, userId, db = knex) => {
  const booking = await db("bookings as b")
    .join("businesses as biz", "b.studio_id", "biz.id")
    .join("business_members as bm", "b.business_member_id", "bm.id")
    .join("users as u2", "bm.user_id", "u2.id")
    .leftJoin("payments as p", "b.payment_id", "p.id")
    .where({ "b.id": id, "b.user_id": userId })
    .select(
      "b.*",
      // Friendly payment state only - see listForUser's comment on why the
      // raw gateway columns on `payments` are never selected here.
      db.raw("coalesce(p.status, 'unpaid') as payment_status"),
      "biz.name as studio_name",
      "biz.address as studio_address",
      "biz.phone as studio_phone",
      "biz.image_url as studio_image",
      "biz.lat",
      "biz.lng",
      // See listForUser - the confirmation/detail pages name the professional.
      "u2.name as member_name",
      "bm.designation as member_designation",
      "bm.image_url as member_image",
      "bm.rating as member_rating"
    )
    .first();

  if (!booking) return null;

  const services = await db("booking_services as bs")
    .join("services as sv", "bs.service_id", "sv.id")
    .where("bs.booking_id", id)
    // sv.id is needed as a stable React key and to rebuild the service list for
    // a reschedule link; without it the Phase 2.5 detail page keyed on undefined.
    .select("sv.id", "sv.name", "bs.price", "bs.duration");

  return { ...booking, services };
};

// Same "occupied" definition as findConflict and the EXCLUDE constraint, so the
// slots shown to a customer are exactly the ones a booking attempt will accept.
export const findBookingsForMemberOnDate = (businessMemberId, date, db = knex) =>
  db("bookings")
    .where({ business_member_id: businessMemberId, booking_date: date })
    .whereNot("status", "cancelled")
    .select("start_time", "end_time");

export const findByIdForStudio = (id, studioId, db = knex) =>
  db("bookings").where({ id, studio_id: studioId }).first();

/**
 * Business-side appointment book - the counterpart to listForUser, scoped to
 * the whole business rather than one customer. Filters are all optional and
 * compose (search + date range + professional + status can all apply at once).
 */
export const listForStudio = async (
  studioId,
  { search, from, to, businessMemberId, status, paymentStatus, page, limit },
  db = knex
) => {
  const applyFilters = (qb, { forCount }) => {
    let query = qb.where("b.studio_id", studioId);

    if (search) {
      query = query.andWhere((sub) =>
        sub
          .whereILike("u.name", `%${search}%`)
          .orWhereILike("u.phone", `%${search}%`)
          .orWhereILike("b.confirmation_code", `%${search}%`)
      );
    }
    if (from) query = query.andWhere("b.booking_date", ">=", from);
    if (to) query = query.andWhere("b.booking_date", "<=", to);
    if (businessMemberId) query = query.andWhere("b.business_member_id", businessMemberId);

    if (status) {
      const statusValues = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      if (statusValues.length === 1) query = query.andWhere("b.status", statusValues[0]);
      else if (statusValues.length > 1) query = query.andWhere("b.status", "in", statusValues);
    }

    if (paymentStatus) {
      query =
        paymentStatus === "unpaid"
          ? query.andWhere((sub) => sub.whereNull("p.status").orWhere("p.status", "unpaid"))
          : query.andWhere("p.status", paymentStatus);
    }

    return forCount ? query.count("b.id as count") : query;
  };

  const rowsQuery = applyFilters(
    db("bookings as b")
      .join("users as u", "b.user_id", "u.id")
      .join("business_members as bm", "b.business_member_id", "bm.id")
      .join("users as u2", "bm.user_id", "u2.id")
      .leftJoin("payments as p", "b.payment_id", "p.id"),
    { forCount: false }
  )
    .select(
      "b.id",
      "b.status",
      "b.booking_date",
      "b.start_time",
      "b.end_time",
      "b.total_amount",
      "b.total_duration",
      "b.confirmation_code",
      "b.notes",
      "b.cancellation_reason",
      "u.id as customer_id",
      "u.name as customer_name",
      "u.phone as customer_phone",
      "u.avatar_url as customer_image",
      "bm.id as business_member_id",
      "bm.designation as member_designation",
      "u2.name as member_name",
      db.raw("coalesce(p.status, 'unpaid') as payment_status")
    )
    .orderBy("b.booking_date", "desc")
    .orderBy("b.start_time", "desc")
    .limit(limit)
    .offset((page - 1) * limit);

  const countQuery = applyFilters(
    db("bookings as b").join("users as u", "b.user_id", "u.id").leftJoin("payments as p", "b.payment_id", "p.id"),
    { forCount: true }
  );

  const [rows, [{ count }]] = await Promise.all([rowsQuery, countQuery]);
  return { rows, total: Number(count) };
};

export const updateStatus = (id, status, patch = {}, db = knex) =>
  db("bookings")
    .where({ id })
    .update({
      status,
      ...(status === "cancelled" ? { cancelled_at: db.fn.now() } : {}),
      ...patch,
      updated_at: db.fn.now(),
    })
    .returning("*")
    .then((rows) => rows[0]);

// Phase 2.5 - the append-only status event log (the "timeline").
export const insertStatusEvent = (event, db = knex) =>
  db("booking_status_events")
    .insert({
      booking_id: event.bookingId,
      from_status: event.fromStatus ?? null,
      to_status: event.toStatus,
      actor_type: event.actorType,
      actor_id: event.actorId ?? null,
      reason: event.reason ?? null,
    })
    .returning("*")
    .then((rows) => rows[0]);

export const listStatusEvents = (bookingId, db = knex) =>
  db("booking_status_events").where({ booking_id: bookingId }).orderBy("created_at", "asc");

// Counterpart to updateReschedule that also allows reassigning the
// professional (drag-and-drop on the business calendar) - a customer can
// never do this, only a business-scoped reschedule needs it.
export const updateBusinessReschedule = (trx, id, { date, startTime, endTime, businessMemberId }) => {
  const patch = { updated_at: trx.fn.now() };
  if (date) patch.booking_date = date;
  if (startTime) patch.start_time = startTime;
  if (endTime) patch.end_time = endTime;
  if (businessMemberId) patch.business_member_id = businessMemberId;
  return trx("bookings").where({ id }).update(patch);
};

export const findTimeOffForMemberOnDate = (businessMemberId, date, db = knex) =>
  db("time_off")
    .where({ business_member_id: businessMemberId, date })
    .select("start_time", "end_time", "is_full_day");
