import * as employeeServiceRepo from "../repositories/employeeService.repository.js";
import * as serviceRepo from "../repositories/service.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * What each professional performs, how long THEY take, and the scheduling
 * rhythm that falls out of it.
 *
 * The owner configures the first two. The third is never configured by anyone -
 * it is derived, every time it is asked for, from the durations already on file.
 * That is the whole point: an owner who has told us Rahul does a beard trim in
 * 20 minutes has already told us Rahul's day runs in 20-minute steps, and asking
 * them to also pick an interval is asking them to restate it in a form they can
 * get wrong.
 */

// Interval bounds and rounding. A raw shortest service of 17 minutes would give
// a 17-minute grid - 9:00, 9:17, 9:34 - which is correct and horrible to read,
// so the derived interval snaps to the nearest 5. The floor stops a short add-on
// (a 5-minute threading) from shredding the day into 140 chips; the ceiling stops
// a shop that only sells 3-hour packages from hiding the free hour at 14:00.
// Nothing is lost to rounding: the grid re-anchors on the exact minute each
// appointment ends, so a booking finishing at 13:07 still offers 13:07.
const INTERVAL_STEP = 5;
const MIN_SLOT_INTERVAL = 10;
const MAX_SLOT_INTERVAL = 60;
const DEFAULT_SLOT_INTERVAL = 30;

/** Shortest service -> the clean rhythm the customer sees. */
export const deriveSlotInterval = (shortestMinutes) => {
  const shortest = Number(shortestMinutes);
  if (!Number.isFinite(shortest) || shortest <= 0) return null;
  const snapped = Math.round(shortest / INTERVAL_STEP) * INTERVAL_STEP;
  return Math.min(Math.max(snapped, MIN_SLOT_INTERVAL), MAX_SLOT_INTERVAL);
};

const toNumber = (value) => (value === null || value === undefined ? null : Number(value));

/**
 * The services this professional can be booked for, with THEIR durations.
 *
 * Zero assignment rows means "not configured yet", not "performs nothing" - such
 * a member falls back to the whole active catalogue at catalogue durations,
 * which is exactly how the system behaved before per-employee durations existed.
 * Without this rule, any member whose rows failed to get written would silently
 * become unbookable, and an empty table would take a whole salon offline.
 */
export const resolveBookableServices = async (memberId, studioId) => {
  const assigned = await employeeServiceRepo.listBookableForMember(memberId);
  if (assigned.length > 0) {
    return {
      services: assigned.map((row) => ({
        id: row.id,
        name: row.name,
        duration: Number(row.duration),
        price: Number(row.price),
      })),
      source: "employee",
    };
  }

  const hasAnyRow = (await employeeServiceRepo.countForMember(memberId)) > 0;
  // Rows exist but every one is switched off (or every service they had was
  // retired): that IS a deliberate empty catalogue, not a missing configuration.
  if (hasAnyRow) return { services: [], source: "employee" };

  const catalogue = await serviceRepo.listForStudio(studioId, { activeOnly: true });
  return {
    services: catalogue.map((row) => ({
      id: row.id,
      name: row.name,
      duration: Number(row.duration),
      price: Number(row.price),
    })),
    source: "catalogue_fallback",
  };
};

/**
 * The scheduling profile the availability grid runs on: this professional's own
 * shortest service, and the interval derived from it.
 *
 * `business` is only consulted when a professional has nothing bookable at all,
 * where there is genuinely nothing to derive from.
 */
export const getSchedulingProfile = async (memberId, studioId, business) => {
  const { services, source } = await resolveBookableServices(memberId, studioId);

  const shortest = services.reduce(
    (min, service) => (min === null || service.duration < min ? service.duration : min),
    null
  );
  const interval = deriveSlotInterval(shortest);

  if (interval === null) {
    return {
      interval: Number(business?.slot_interval_minutes) || DEFAULT_SLOT_INTERVAL,
      intervalSource: "business_setting",
      shortestServiceDuration: null,
      serviceCount: services.length,
    };
  }

  return {
    interval,
    intervalSource: source === "employee" ? "employee_services" : "studio_catalogue",
    shortestServiceDuration: shortest,
    serviceCount: services.length,
  };
};

/**
 * Effective rows for one basket, scoped to one professional - the durations and
 * prices the booking will actually be written with.
 *
 * Throws when the professional doesn't perform something in the basket, rather
 * than quietly dropping it: a customer who picked Hair Colour must not end up
 * with a booking that silently isn't for Hair Colour.
 */
export const resolveBasketForMember = async (memberId, studioId, serviceIds) => {
  const ids = [...new Set(serviceIds.map(String))];
  const { services, source } = await resolveBookableServices(memberId, studioId);
  const byId = new Map(services.map((service) => [String(service.id), service]));

  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new ServiceError(
      400,
      source === "catalogue_fallback"
        ? "One or more services not found for this business"
        : "This professional doesn't offer one or more of the selected services"
    );
  }

  return ids.map((id) => byId.get(id));
};

/* --------------------------- owner-facing screen -------------------------- */

const assertMember = async (studioId, memberId) => {
  const member = await businessMemberRepo.findByIdForStudio(memberId, studioId);
  if (!member) throw new ServiceError(404, "Team member not found at this business");
  return member;
};

/**
 * The assignment screen: the whole catalogue, each row carrying whether this
 * employee performs it and at what duration. Unassigned services are included -
 * they're the checkboxes the owner hasn't ticked yet.
 */
export const getMemberCatalogue = async (studioId, memberId) => {
  const [member, rows, business] = await Promise.all([
    assertMember(studioId, memberId),
    employeeServiceRepo.listCatalogueForMember(studioId, memberId),
    businessRepo.findById(studioId),
  ]);

  const usingFallback = rows.every((row) => row.assignment_id === null);

  const services = rows.map((row) => {
    const defaultDuration = Number(row.default_duration);
    // A member with no rows at all performs everything at catalogue durations,
    // so the screen must OPEN in that state rather than showing every box
    // unticked - which would misrepresent who can currently be booked.
    const enabled = row.assignment_id === null ? usingFallback : Boolean(row.is_enabled);
    return {
      serviceId: row.service_id,
      name: row.name,
      categoryName: row.category_name ?? row.custom_category ?? null,
      imageUrl: row.image_url,
      isActive: row.is_active,
      defaultDuration,
      defaultPrice: toNumber(row.default_price),
      enabled,
      duration: row.override_duration === null || row.override_duration === undefined
        ? defaultDuration
        : Number(row.override_duration),
      price: toNumber(row.override_price),
    };
  });

  const profile = await getSchedulingProfile(memberId, studioId, business);

  return {
    member: { id: member.id, name: member.name, designation: member.designation, providesServices: member.provides_services },
    services,
    // Read-only on the client. Sent alongside the rows it was computed from so
    // the owner can see the cause and effect on one screen.
    scheduling: profile,
    configured: !usingFallback,
  };
};

/**
 * Replace this employee's assignments wholesale.
 *
 * Wholesale rather than per-row because the screen is a single form: anything
 * the owner left unticked is an instruction to stop offering it, and diffing
 * that client-side would make an interrupted save leave a half-applied catalogue.
 */
export const setMemberCatalogue = async (studioId, memberId, items) => {
  await assertMember(studioId, memberId);

  const catalogue = await serviceRepo.listForStudio(studioId);
  const catalogueIds = new Set(catalogue.map((row) => String(row.id)));

  const enabled = items.filter((item) => item.enabled);
  const unknown = enabled.find((item) => !catalogueIds.has(String(item.serviceId)));
  if (unknown) throw new ServiceError(400, "One or more services don't belong to this business");

  await employeeServiceRepo.runInTransaction(async (trx) => {
    for (const item of enabled) {
      await employeeServiceRepo.upsert(
        {
          business_member_id: memberId,
          service_id: item.serviceId,
          duration: item.duration,
          price: item.price ?? null,
          is_enabled: true,
          updated_at: trx.fn.now(),
        },
        trx
      );
    }
    await employeeServiceRepo.disableMissing(memberId, enabled.map((item) => item.serviceId), trx);
  });

  return getMemberCatalogue(studioId, memberId);
};
