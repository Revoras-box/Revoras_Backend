import knex from "../../db/knex.js";

const OFFER_FIELDS = [
  "id",
  "studio_id",
  "title",
  "description",
  "discount_type",
  "discount_value",
  "max_discount_amount",
  "min_spend",
  "applies_to",
  "start_at",
  "end_at",
  "is_active",
  "max_uses",
  "max_uses_per_user",
  "first_time_only",
  "created_by",
  "created_at",
  "updated_at",
];

export const create = (row, db = knex) =>
  db("offers").insert(row).returning(OFFER_FIELDS).then((rows) => rows[0]);

export const findById = (id, db = knex) => db("offers").where({ id }).select(OFFER_FIELDS).first();

export const findByIdForStudio = (id, studioId, db = knex) =>
  db("offers").where({ id, studio_id: studioId }).select(OFFER_FIELDS).first();

export const listForStudio = (studioId, db = knex) =>
  db("offers").where({ studio_id: studioId }).select(OFFER_FIELDS).orderBy("created_at", "desc");

export const update = (id, patch, db = knex) =>
  db("offers")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(OFFER_FIELDS)
    .then((rows) => rows[0]);

export const remove = (id, db = knex) => db("offers").where({ id }).del();

// ---- offer_services (service targeting) ----

export const listServiceIds = async (offerId, db = knex) => {
  const rows = await db("offer_services").where({ offer_id: offerId }).select("service_id");
  return rows.map((r) => r.service_id);
};

export const setServices = async (offerId, serviceIds, db = knex) => {
  await db("offer_services").where({ offer_id: offerId }).del();
  if (serviceIds.length > 0) {
    await db("offer_services").insert(serviceIds.map((service_id) => ({ offer_id: offerId, service_id })));
  }
};

/**
 * Phase 2.4 - the service-id sets for many offers in one query, to avoid an
 * N+1 when resolving a whole page of offers (offer list, discovery). Returns a
 * Map<offerId, string[]>.
 */
export const serviceIdsByOffer = async (offerIds, db = knex) => {
  const map = new Map(offerIds.map((id) => [id, []]));
  if (offerIds.length === 0) return map;
  const rows = await db("offer_services").whereIn("offer_id", offerIds).select("offer_id", "service_id");
  for (const r of rows) map.get(r.offer_id)?.push(r.service_id);
  return map;
};

/**
 * Phase 2.4 - currently-live offers (active + inside their date window) for a
 * business, used by the offer engine. "Currently" is evaluated in SQL against
 * now() so a scheduled or expired offer never leaks into customer-facing paths.
 */
export const listCurrentlyLiveForStudio = (studioId, db = knex) =>
  db("offers")
    .where({ studio_id: studioId, is_active: true })
    .andWhere((qb) => qb.whereNull("start_at").orWhere("start_at", "<=", db.fn.now()))
    .andWhere((qb) => qb.whereNull("end_at").orWhere("end_at", ">=", db.fn.now()))
    .select(OFFER_FIELDS)
    .orderBy("created_at", "desc");

/**
 * Phase 2.4 - all currently-live offers for a set of studios, grouped, in one
 * query. Backs the discovery card badge (summarized per studio) without an
 * N+1. Returns Map<studioId, offers[]>; studios with no live offer are absent.
 */
export const liveOffersByStudioIds = async (studioIds, db = knex) => {
  const map = new Map();
  if (!studioIds || studioIds.length === 0) return map;
  const rows = await db("offers")
    .whereIn("studio_id", studioIds)
    .andWhere({ is_active: true })
    .andWhere((qb) => qb.whereNull("start_at").orWhere("start_at", "<=", db.fn.now()))
    .andWhere((qb) => qb.whereNull("end_at").orWhere("end_at", ">=", db.fn.now()))
    .select(OFFER_FIELDS);
  for (const row of rows) {
    if (!map.has(row.studio_id)) map.set(row.studio_id, []);
    map.get(row.studio_id).push(row);
  }
  return map;
};

/**
 * Studio ids (from a candidate set) that have at least one currently-live
 * offer - one query for a whole discovery page rather than per-card. Powers
 * the `hasOffers` filter and the offer badge. Returns a Set.
 */
export const studioIdsWithLiveOffers = async (studioIds, db = knex) => {
  if (!studioIds || studioIds.length === 0) return new Set();
  const rows = await db("offers")
    .whereIn("studio_id", studioIds)
    .andWhere({ is_active: true })
    .andWhere((qb) => qb.whereNull("start_at").orWhere("start_at", "<=", db.fn.now()))
    .andWhere((qb) => qb.whereNull("end_at").orWhere("end_at", ">=", db.fn.now()))
    .distinct("studio_id");
  return new Set(rows.map((r) => r.studio_id));
};

// ---- usage counting (from booking snapshots, no counter column) ----

export const countUses = async (offerId, db = knex) => {
  const [{ count }] = await db("bookings").where({ offer_id: offerId }).count("* as count");
  return Number(count);
};

export const countUsesByUser = async (offerId, userId, db = knex) => {
  const [{ count }] = await db("bookings").where({ offer_id: offerId, user_id: userId }).count("* as count");
  return Number(count);
};

/**
 * Phase 2.4 - has this customer ever booked at this business? Backs the
 * `first_time_only` guard. Any prior booking (regardless of status) counts as
 * "not first-time" - a customer who booked and cancelled isn't new.
 */
export const userHasBookingAtStudio = async (userId, studioId, db = knex) => {
  const row = await db("bookings").where({ user_id: userId, studio_id: studioId }).first("id");
  return !!row;
};
