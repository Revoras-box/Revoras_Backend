import knex from "../../db/knex.js";

/**
 * Reads and writes the per-employee slice of the service catalogue.
 *
 * Everything here answers one of two questions: "what does this professional
 * perform, and how long do THEY take?" (booking + availability) or "what should
 * the owner see on the assignment screen?" (the full catalogue, with each
 * employee's overrides layered on).
 *
 * Nothing here applies the zero-rows fallback - that's a policy decision and
 * lives in employeeService.service.js, so both callers can't drift apart.
 */

/** Catalogue fields the owner's assignment screen and the booking flow both need. */
const CATALOGUE_FIELDS = [
  "sv.id as service_id",
  "sv.name",
  "sv.description",
  "sv.category_id",
  "sv.custom_category",
  "c.name as category_name",
  "sv.price as default_price",
  "sv.duration as default_duration",
  "sv.image_url",
  "sv.is_active",
];

/**
 * The whole catalogue with this member's assignment layered on - a LEFT JOIN, so
 * services they don't perform come back too (as `assigned: false`). The owner's
 * screen needs the unassigned ones to offer them as checkboxes.
 */
export const listCatalogueForMember = (studioId, memberId, db = knex) =>
  db("services as sv")
    .leftJoin("categories as c", "sv.category_id", "c.id")
    .leftJoin("employee_services as es", function joinAssignment() {
      this.on("es.service_id", "=", "sv.id").andOn("es.business_member_id", "=", db.raw("?", [memberId]));
    })
    .where({ "sv.studio_id": studioId })
    .select([
      ...CATALOGUE_FIELDS,
      "es.id as assignment_id",
      "es.duration as override_duration",
      "es.price as override_price",
      "es.is_enabled",
    ])
    .orderBy(["c.sort_order", "sv.name"]);

/** How many assignment rows this member has at all - drives the zero-rows fallback. */
export const countForMember = async (memberId, db = knex) => {
  const row = await db("employee_services").where({ business_member_id: memberId }).count("* as count").first();
  return Number(row.count);
};

/**
 * The services this member can actually be booked for: enabled for them AND
 * still active in the shop's catalogue. A service the owner retires disappears
 * from every employee at once without touching a single assignment row.
 */
export const listBookableForMember = (memberId, db = knex) =>
  db("employee_services as es")
    .join("services as sv", "es.service_id", "sv.id")
    .where({ "es.business_member_id": memberId, "es.is_enabled": true, "sv.is_active": true })
    .select(
      "sv.id",
      "sv.name",
      "sv.studio_id",
      "es.duration",
      // The employee's price when one was set, the catalogue's otherwise. Done
      // in SQL so every caller gets the same effective figure and none of them
      // has to remember the null rule.
      knex.raw("coalesce(es.price, sv.price) as price"),
      "sv.duration as default_duration",
      "sv.price as default_price"
    );

/**
 * Effective rows for a specific basket of services, scoped to one professional.
 * Returns fewer rows than asked for when a service isn't performed by them -
 * callers treat that as "this professional can't do this booking".
 */
export const findBookableByIdsForMember = (memberId, serviceIds, db = knex) =>
  db("employee_services as es")
    .join("services as sv", "es.service_id", "sv.id")
    .whereIn("es.service_id", serviceIds)
    .andWhere({ "es.business_member_id": memberId, "es.is_enabled": true, "sv.is_active": true })
    .select("sv.id", "sv.name", "es.duration", knex.raw("coalesce(es.price, sv.price) as price"));

/** Shortest thing this professional performs, in minutes. Null when nothing is assigned. */
export const minDurationForMember = async (memberId, db = knex) => {
  const row = await db("employee_services as es")
    .join("services as sv", "es.service_id", "sv.id")
    .where({ "es.business_member_id": memberId, "es.is_enabled": true, "sv.is_active": true })
    .min({ shortest: "es.duration" })
    .first();

  const shortest = Number(row?.shortest);
  return Number.isFinite(shortest) && shortest > 0 ? shortest : null;
};

/**
 * The same MIN for a whole team in one query. The team-availability endpoint
 * needs every member's own interval, and asking per member turns a 5-chair salon
 * into 5 round trips for data one GROUP BY already has.
 */
export const minDurationByMemberForStudio = async (studioId, db = knex) => {
  const rows = await db("employee_services as es")
    .join("services as sv", "es.service_id", "sv.id")
    .join("business_members as bm", "es.business_member_id", "bm.id")
    .where({ "bm.studio_id": studioId, "es.is_enabled": true, "sv.is_active": true })
    .groupBy("es.business_member_id")
    .select("es.business_member_id")
    .min({ shortest: "es.duration" });

  return new Map(rows.map((row) => [String(row.business_member_id), Number(row.shortest)]));
};

/**
 * Every bookable professional's durations for a whole studio, for the customer's
 * booking screen - it has to show "50 min with Rahul, 65 min with Aman" before
 * the customer has picked either of them.
 */
export const listBookableForStudioMembers = (studioId, db = knex) =>
  db("employee_services as es")
    .join("services as sv", "es.service_id", "sv.id")
    .join("business_members as bm", "es.business_member_id", "bm.id")
    .where({
      "bm.studio_id": studioId,
      "bm.status": "active",
      "bm.provides_services": true,
      "es.is_enabled": true,
      "sv.is_active": true,
    })
    .select("es.business_member_id", "sv.id as service_id", "es.duration", knex.raw("coalesce(es.price, sv.price) as price"));

/**
 * Upsert one assignment. `merge` rather than delete-and-reinsert so an owner
 * toggling a service off and on again keeps the duration they typed.
 */
export const upsert = (row, db = knex) =>
  db("employee_services")
    .insert(row)
    .onConflict(["business_member_id", "service_id"])
    .merge(["duration", "price", "is_enabled", "updated_at"]);

/** Turn off every assignment for a member that isn't in `keepServiceIds`. */
export const disableMissing = (memberId, keepServiceIds, db = knex) => {
  const query = db("employee_services")
    .where({ business_member_id: memberId })
    .update({ is_enabled: false, updated_at: db.fn.now() });

  return keepServiceIds.length ? query.whereNotIn("service_id", keepServiceIds) : query;
};

/**
 * A newly created service is offered by everyone by default, at the catalogue
 * duration. Salons add "common" services far more often than specialist ones, so
 * assign-to-all-then-uncheck is the shorter path for the owner; the assignment
 * screen shows exactly who got it.
 *
 * Members with NO assignment rows are skipped deliberately. Such a member is in
 * the "not configured yet" fallback and already performs the whole active
 * catalogue - including this new service. Writing them a single row would take
 * them out of that fallback and leave them performing exactly one thing.
 */
export const assignServiceToBookableMembers = (serviceId, studioId, duration, db = knex) =>
  db.raw(
    `
    INSERT INTO employee_services (business_member_id, service_id, duration)
    SELECT bm.id, ?, ?
    FROM business_members bm
    WHERE bm.studio_id = ? AND bm.status = 'active' AND bm.provides_services = true
      AND EXISTS (SELECT 1 FROM employee_services es WHERE es.business_member_id = bm.id)
    ON CONFLICT (business_member_id, service_id) DO NOTHING
  `,
    [serviceId, duration, studioId]
  );

/**
 * Seed a brand-new professional with the shop's whole active catalogue at
 * catalogue durations, so the owner's assignment screen opens with real rows to
 * adjust rather than an empty form.
 */
export const seedCatalogueForMember = (memberId, studioId, db = knex) =>
  db.raw(
    `
    INSERT INTO employee_services (business_member_id, service_id, duration)
    SELECT ?, s.id, s.duration
    FROM services s
    WHERE s.studio_id = ? AND s.is_active = true
    ON CONFLICT (business_member_id, service_id) DO NOTHING
  `,
    [memberId, studioId]
  );

export const runInTransaction = (fn) => knex.transaction(fn);
