import * as recentlyViewedService from "../services/recentlyViewed.service.js";

// GET /api/profile/recently-viewed
export const listRecentlyViewed = async (req, res) => {
  const businesses = await recentlyViewedService.listBusinesses(req.user.id, req.query.limit);
  res.json({ businesses });
};

// GET /api/profile/recently-viewed/professionals
export const listRecentlyViewedProfessionals = async (req, res) => {
  const professionals = await recentlyViewedService.listProfessionals(req.user.id, req.query.limit);
  res.json({ professionals });
};

// POST /api/profile/recently-viewed/:studioId
// Fire-and-forget from the client's side: 204, no body. The customer is
// looking at a business page, not waiting on a bookkeeping write.
export const recordBusinessView = async (req, res) => {
  await recentlyViewedService.recordBusinessView(req.user.id, req.params.studioId);
  res.status(204).end();
};

// POST /api/profile/recently-viewed/professionals/:memberId
export const recordProfessionalView = async (req, res) => {
  await recentlyViewedService.recordProfessionalView(req.user.id, req.params.memberId);
  res.status(204).end();
};

// DELETE /api/profile/recently-viewed
export const clearRecentlyViewed = async (req, res) => {
  await recentlyViewedService.clear(req.user.id);
  res.json({ message: "Recently viewed cleared" });
};
