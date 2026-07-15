import * as recentlyViewedRepo from "../repositories/recentlyViewed.repository.js";
import * as discoveryRepo from "../repositories/discovery.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Phase 2.3 (Decision D2, hybrid recently-viewed): this service only ever runs
 * for authenticated users. Anonymous visitors keep the client-side localStorage
 * path (`Revoras/src/lib/recently-viewed.ts`) - logged-out browsing is real
 * discovery traffic and shouldn't lose the feature.
 *
 * Matches the client store's cap of 12 so both halves of the hybrid behave the
 * same way; a caller can ask for fewer, not more.
 */
export const DEFAULT_LIMIT = 12;
export const MAX_LIMIT = 50;

const clampLimit = (limit) => {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.trunc(n), MAX_LIMIT);
};

export const recordBusinessView = async (userId, studioId) => {
  const business = await discoveryRepo.findBusinessPublic(studioId);
  if (!business) throw new ServiceError(404, "Business not found");
  await recentlyViewedRepo.recordBusinessView(userId, studioId);
};

export const recordProfessionalView = async (userId, memberId) => {
  const professional = await discoveryRepo.findProfessionalPublic(memberId);
  if (!professional) throw new ServiceError(404, "Professional not found");
  await recentlyViewedRepo.recordProfessionalView(userId, memberId);
};

export const listBusinesses = (userId, limit) => recentlyViewedRepo.listBusinessesForUser(userId, clampLimit(limit));

export const listProfessionals = (userId, limit) =>
  recentlyViewedRepo.listProfessionalsForUser(userId, clampLimit(limit));

export const clear = (userId) => recentlyViewedRepo.clearForUser(userId);
