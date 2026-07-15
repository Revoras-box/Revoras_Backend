import * as favoriteRepo from "../repositories/favorite.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as discoveryRepo from "../repositories/discovery.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

export const list = (userId) => favoriteRepo.listForUser(userId);

// Phase 2.3 - id-only projection backing the heart on every discovery card.
export const listIds = (userId) => favoriteRepo.listIdsForUser(userId);

export const add = async (userId, studioId) => {
  const business = await businessRepo.findById(studioId);
  if (!business) throw new ServiceError(404, "Business not found");

  const existing = await favoriteRepo.findOne(userId, studioId);
  if (existing) throw new ServiceError(409, "Business is already in favorites");

  await favoriteRepo.create(userId, studioId);
};

export const remove = async (userId, studioId) => {
  const deleted = await favoriteRepo.remove(userId, studioId);
  if (deleted === 0) throw new ServiceError(404, "Favorite not found");
};

// Phase 2.3 - professional favorites. Same shape as the business path above
// (existence check → duplicate check → write) so both behave identically from
// the client's side: 404 on an unknown target, 409 on a re-favorite.
export const listProfessionals = (userId) => favoriteRepo.listProfessionalsForUser(userId);

export const addProfessional = async (userId, memberId) => {
  // findProfessionalPublic, not a raw member lookup: a customer may only
  // favorite a professional they could actually discover - it enforces
  // active member + active business, so a suspended studio's staff can't be
  // favorited through a guessed id.
  const professional = await discoveryRepo.findProfessionalPublic(memberId);
  if (!professional) throw new ServiceError(404, "Professional not found");

  const existing = await favoriteRepo.findOneProfessional(userId, memberId);
  if (existing) throw new ServiceError(409, "Professional is already in favorites");

  await favoriteRepo.createProfessional(userId, memberId);
};

export const removeProfessional = async (userId, memberId) => {
  const deleted = await favoriteRepo.removeProfessional(userId, memberId);
  if (deleted === 0) throw new ServiceError(404, "Favorite not found");
};
