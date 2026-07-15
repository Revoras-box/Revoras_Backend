import * as adminBusinessRepo from "../repositories/adminBusiness.repository.js";
import * as serviceRepo from "../repositories/service.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as workingHoursRepo from "../repositories/workingHours.repository.js";
import * as adminActivityLogService from "./adminActivityLog.service.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as lifecycle from "./businessLifecycle.service.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Geocode via OpenStreetMap Nominatim (free, no API key) - ported unchanged
 * from the old admin.controller.js, still the right approach (report.md's
 * "only change what has a clear benefit" rule - this wasn't broken).
 */
const geocodeAddress = async (address, city, state, country = "India") => {
  const attempts = [
    [address, city, state, country].filter(Boolean).join(", "),
    [city, state, country].filter(Boolean).join(", "),
    [city, country].filter(Boolean).join(", "),
  ];

  for (const query of attempts) {
    if (!query.trim()) continue;

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, {
        headers: {
          "User-Agent": "Revoras-App/1.0 (https://revoras.tech; admin@revoras.tech)",
          Accept: "application/json",
          "Accept-Language": "en",
        },
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (data && data.length > 0) {
        return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), displayName: data[0].display_name };
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch {
      // try the next, less specific query
    }
  }

  return null;
};

export const list = async (query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;

  const { rows, total } = await adminBusinessRepo.listForAdmin({
    status: query.status,
    search: query.search,
    page,
    limit,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
  });

  return { businesses: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

export const getById = async (id) => {
  const business = await adminBusinessRepo.findByIdForAdmin(id);
  if (!business) throw new ServiceError(404, "Business not found");

  const [owner, services, members, workingHours] = await Promise.all([
    adminBusinessRepo.findOwnerForBusiness(id),
    serviceRepo.listForStudio(id, {}),
    businessMemberRepo.listForStudio(id),
    workingHoursRepo.listForStudio(id),
  ]);

  return { ...business, owner, services, members, workingHours };
};

export const update = async (id, input, adminId, ipAddress) => {
  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.address !== undefined) patch.address = input.address;
  if (input.city !== undefined) patch.city = input.city;
  if (input.state !== undefined) patch.state = input.state;
  if (input.zipCode !== undefined) patch.zip_code = input.zipCode;
  if (input.country !== undefined) patch.country = input.country;
  if (input.lat !== undefined) patch.lat = input.lat;
  if (input.lng !== undefined) patch.lng = input.lng;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.description !== undefined) patch.description = input.description;
  if (input.imageUrl !== undefined) patch.image_url = input.imageUrl;
  if (input.adminNotes !== undefined) patch.admin_notes = input.adminNotes;
  if (input.amenities !== undefined) patch.amenities = JSON.stringify(input.amenities);

  if (Object.keys(patch).length === 0) throw new ServiceError(400, "No fields to update");

  const updated = await adminBusinessRepo.update(id, patch);
  if (!updated) throw new ServiceError(404, "Business not found");

  await adminActivityLogService.log(adminId, "update_business", "business", id, { fields: Object.keys(patch) }, ipAddress);

  return updated;
};

/**
 * Phase 2.2 (Discovery Curation System) - Featured Businesses. Pure metadata
 * write; the boost/badge itself is computed live in discovery.repository.js
 * (FEATURED_EFFECTIVE_SQL) from these columns, not written here - so turning
 * a feature off, or letting its end_at lapse, takes effect on the very next
 * discovery query with no separate "unfeature" job needed.
 */
export const setFeatured = async (id, input, adminId, ipAddress) => {
  const patch = {
    is_featured: input.isFeatured,
    featured_priority: input.isFeatured ? input.priority ?? 0 : 0,
    featured_start_at: input.startAt ?? null,
    featured_end_at: input.endAt ?? null,
    featured_region: input.region ?? null,
    featured_reason: input.reason ?? null,
  };

  const updated = await adminBusinessRepo.update(id, patch);
  if (!updated) throw new ServiceError(404, "Business not found");

  await adminActivityLogService.log(
    adminId,
    input.isFeatured ? "feature_business" : "unfeature_business",
    "business",
    id,
    { priority: patch.featured_priority, region: patch.featured_region },
    ipAddress
  );

  return updated;
};

export const approve = async (id, adminId, { adminNotes }, ipAddress) => {
  const business = await adminBusinessRepo.findByIdForAdmin(id);
  if (!business) throw new ServiceError(404, "Business not found");

  let lat = business.lat;
  let lng = business.lng;
  const neededGeocoding = !lat || !lng;

  if (neededGeocoding) {
    const geocoded = await geocodeAddress(business.address, business.city, business.state, business.country);
    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
  }

  // Non-status fields (approver, geocode) go through the plain update; the
  // status change goes through BusinessLifecycleService, the single authority.
  const patch = { approved_by: adminId, approved_at: new Date(), lat, lng };
  if (adminNotes !== undefined) patch.admin_notes = adminNotes;
  await businessRepo.update(id, patch);

  await lifecycle.transition(id, lifecycle.STATUS.APPROVED);
  // Auto-activate iff every O1 condition holds. Since Phase 1.5d,
  // paymentDone/subscriptionActive are real (businessLifecycle.service.js's
  // activationConditions) - a business without a captured ₹99 payment now stays
  // at APPROVED (not auto-activated) until the owner pays. onboardingComplete
  // still defaults to satisfied (1.5b hasn't tightened it yet).
  const activation = await lifecycle.activateBusiness(id);

  await adminActivityLogService.log(
    adminId,
    "approve_business",
    "business",
    id,
    { previousStatus: business.business_status, activated: activation.activated, geocoded: neededGeocoding && Boolean(lat) },
    ipAddress
  );

  return adminBusinessRepo.findByIdForAdmin(id);
};

export const reject = async (id, adminId, { reason, adminNotes }, ipAddress) => {
  if (!reason) throw new ServiceError(400, "Rejection reason is required");

  const extra = { rejection_reason: reason };
  if (adminNotes !== undefined) extra.admin_notes = adminNotes;
  await lifecycle.transition(id, lifecycle.STATUS.REJECTED, { extra });

  await adminActivityLogService.log(adminId, "reject_business", "business", id, { reason }, ipAddress);

  return adminBusinessRepo.findByIdForAdmin(id);
};

export const suspend = async (id, adminId, { reason, adminNotes }, ipAddress) => {
  await lifecycle.transition(id, lifecycle.STATUS.SUSPENDED, {
    extra: { admin_notes: adminNotes || reason || null },
  });

  await adminActivityLogService.log(adminId, "suspend_business", "business", id, { reason }, ipAddress);

  return adminBusinessRepo.findByIdForAdmin(id);
};

export const geocode = async (id, input, adminId, ipAddress) => {
  const current = await adminBusinessRepo.findAddressInfo(id);
  if (!current) throw new ServiceError(404, "Business not found");

  const geocoded = await geocodeAddress(
    input.address || current.address,
    input.city || current.city,
    input.state || current.state,
    input.country || current.country
  );
  if (!geocoded) throw new ServiceError(400, "Could not geocode address");

  const updated = await adminBusinessRepo.setLatLng(id, { lat: geocoded.lat, lng: geocoded.lng });

  await adminActivityLogService.log(
    adminId,
    "geocode_business",
    "business",
    id,
    { lat: geocoded.lat, lng: geocoded.lng, displayName: geocoded.displayName },
    ipAddress
  );

  return { ...updated, displayName: geocoded.displayName };
};
