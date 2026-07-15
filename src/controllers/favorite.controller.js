import * as favoriteService from "../services/favorite.service.js";

// GET /api/profile/favorites
export const listFavorites = async (req, res) => {
  const favorites = await favoriteService.list(req.user.id);
  res.json({ favorites });
};

// GET /api/profile/favorites/ids
export const listFavoriteIds = async (req, res) => {
  const ids = await favoriteService.listIds(req.user.id);
  res.json(ids);
};

// POST /api/profile/favorites/:studioId
export const addFavorite = async (req, res) => {
  await favoriteService.add(req.user.id, req.params.studioId);
  res.status(201).json({ message: "Added to favorites" });
};

// DELETE /api/profile/favorites/:studioId
export const removeFavorite = async (req, res) => {
  await favoriteService.remove(req.user.id, req.params.studioId);
  res.json({ message: "Removed from favorites" });
};

// GET /api/profile/favorites/professionals
export const listFavoriteProfessionals = async (req, res) => {
  const professionals = await favoriteService.listProfessionals(req.user.id);
  res.json({ professionals });
};

// POST /api/profile/favorites/professionals/:memberId
export const addFavoriteProfessional = async (req, res) => {
  await favoriteService.addProfessional(req.user.id, req.params.memberId);
  res.status(201).json({ message: "Added to favorites" });
};

// DELETE /api/profile/favorites/professionals/:memberId
export const removeFavoriteProfessional = async (req, res) => {
  await favoriteService.removeProfessional(req.user.id, req.params.memberId);
  res.json({ message: "Removed from favorites" });
};
