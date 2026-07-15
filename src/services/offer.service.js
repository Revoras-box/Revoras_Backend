import * as offerRepo from "../repositories/offer.repository.js";
import * as serviceRepo from "../repositories/service.repository.js";
import knex from "../../db/knex.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Phase 2.4 (Offers & Promotions) - CRUD over `offers`/`offer_services`. The
 * discount math and "which offer wins" live in offer.engine.js; this file owns
 * lifecycle (create/update/delete + service targeting) and the derived status
 * the dashboard shows.
 */

/**
 * A display status derived from the same fields the offer engine gates on, so
 * "Active" in the dashboard means exactly "a customer could get this right
 * now". Computed, never stored - a scheduled offer becomes active at its
 * start_at with no job to flip a flag.
 */
export const deriveStatus = (row, now = new Date()) => {
  if (!row.is_active) return "inactive";
  if (row.start_at && new Date(row.start_at) > now) return "scheduled";
  if (row.end_at && new Date(row.end_at) < now) return "expired";
  return "active";
};

const serializeOffer = (row, { serviceIds = [], usageCount = null } = {}) => ({
  id: row.id,
  studioId: row.studio_id,
  title: row.title,
  description: row.description,
  discountType: row.discount_type,
  discountValue: Number(row.discount_value),
  maxDiscountAmount: row.max_discount_amount != null ? Number(row.max_discount_amount) : null,
  minSpend: row.min_spend != null ? Number(row.min_spend) : null,
  appliesTo: row.applies_to,
  serviceIds,
  startAt: row.start_at,
  endAt: row.end_at,
  isActive: row.is_active,
  maxUses: row.max_uses,
  maxUsesPerUser: row.max_uses_per_user,
  firstTimeOnly: row.first_time_only,
  status: deriveStatus(row),
  usageCount,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const buildRow = (input) => {
  const row = {};
  if (input.title !== undefined) row.title = input.title;
  if (input.description !== undefined) row.description = input.description;
  if (input.discountType !== undefined) row.discount_type = input.discountType;
  if (input.discountValue !== undefined) row.discount_value = input.discountValue;
  if (input.maxDiscountAmount !== undefined) row.max_discount_amount = input.maxDiscountAmount;
  if (input.minSpend !== undefined) row.min_spend = input.minSpend;
  if (input.appliesTo !== undefined) row.applies_to = input.appliesTo;
  if (input.startAt !== undefined) row.start_at = input.startAt;
  if (input.endAt !== undefined) row.end_at = input.endAt;
  if (input.isActive !== undefined) row.is_active = input.isActive;
  if (input.maxUses !== undefined) row.max_uses = input.maxUses;
  if (input.maxUsesPerUser !== undefined) row.max_uses_per_user = input.maxUsesPerUser;
  if (input.firstTimeOnly !== undefined) row.first_time_only = input.firstTimeOnly;
  return row;
};

/**
 * Service targeting must reference services that belong to THIS business, or an
 * owner could scope an offer to a competitor's service id. Validated before any
 * write.
 */
const assertServicesBelongToStudio = async (studioId, serviceIds) => {
  if (!serviceIds || serviceIds.length === 0) return;
  const rows = await serviceRepo.findActiveByIdsForStudio([...new Set(serviceIds.map(String))], studioId);
  if (rows.length !== new Set(serviceIds.map(String)).size) {
    throw new ServiceError(400, "One or more targeted services do not belong to this business");
  }
};

export const list = async (studioId) => {
  const rows = await offerRepo.listForStudio(studioId);
  const serviceMap = await offerRepo.serviceIdsByOffer(rows.map((r) => r.id));
  return rows.map((row) => serializeOffer(row, { serviceIds: serviceMap.get(row.id) ?? [] }));
};

export const getById = async (id, studioId) => {
  const offer = await offerRepo.findByIdForStudio(id, studioId);
  if (!offer) throw new ServiceError(404, "Offer not found");
  const serviceIds = await offerRepo.listServiceIds(id);
  const usageCount = await offerRepo.countUses(id);
  return serializeOffer(offer, { serviceIds, usageCount });
};

export const create = async (studioId, input, userId) => {
  if (input.appliesTo === "services") {
    await assertServicesBelongToStudio(studioId, input.serviceIds);
  }

  const created = await knex.transaction(async (trx) => {
    const offer = await offerRepo.create({ ...buildRow(input), studio_id: studioId, created_by: userId }, trx);
    if (input.appliesTo === "services") {
      await offerRepo.setServices(offer.id, input.serviceIds, trx);
    }
    return offer;
  });

  return getById(created.id, studioId);
};

export const update = async (id, studioId, input) => {
  const existing = await offerRepo.findByIdForStudio(id, studioId);
  if (!existing) throw new ServiceError(404, "Offer not found");

  // The effective scope after this patch decides whether serviceIds are
  // required/validated - an update can switch an offer from business to
  // service-scoped or back.
  const effectiveAppliesTo = input.appliesTo ?? existing.applies_to;
  if (effectiveAppliesTo === "services" && input.serviceIds !== undefined) {
    await assertServicesBelongToStudio(studioId, input.serviceIds);
  }

  await knex.transaction(async (trx) => {
    await offerRepo.update(id, buildRow(input), trx);
    if (input.appliesTo === "business") {
      // Switched off service targeting - clear any stale links.
      await offerRepo.setServices(id, [], trx);
    } else if (input.serviceIds !== undefined) {
      await offerRepo.setServices(id, input.serviceIds, trx);
    }
  });

  return getById(id, studioId);
};

export const remove = async (id, studioId) => {
  const existing = await offerRepo.findByIdForStudio(id, studioId);
  if (!existing) throw new ServiceError(404, "Offer not found");
  // bookings.offer_id is ON DELETE SET NULL, so past bookings keep their frozen
  // discount snapshot; only the reusable rule goes away.
  await offerRepo.remove(id);
};
