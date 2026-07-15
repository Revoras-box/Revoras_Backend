import express from "express";
import { getProfile, updateProfile, updateNotificationSettings, deleteAccount } from "../controllers/profile.controller.js";
import {
  listFavorites,
  listFavoriteIds,
  addFavorite,
  removeFavorite,
  listFavoriteProfessionals,
  addFavoriteProfessional,
  removeFavoriteProfessional,
} from "../controllers/favorite.controller.js";
import {
  listRecentlyViewed,
  listRecentlyViewedProfessionals,
  recordBusinessView,
  recordProfessionalView,
  clearRecentlyViewed,
} from "../controllers/recentlyViewed.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { apiLimiter, strictLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.use(authenticate);

router.get("/", apiLimiter, getProfile);
router.put("/", strictLimiter, updateProfile);
router.delete("/", strictLimiter, deleteAccount);

router.put("/notifications", strictLimiter, updateNotificationSettings);

/**
 * Route order (Phase 2.3): the `/professionals` routes are registered before
 * their `/:studioId` siblings. They don't strictly collide today - Express
 * matches `:studioId` against a single segment, so `/favorites/professionals/x`
 * can't reach it - but `GET /favorites/professionals` and a future
 * `GET /favorites/:studioId` would, and discovery.routes.js already learned
 * this lesson with `/businesses/map`. Ordering defensively costs nothing.
 */
router.get("/favorites/professionals", apiLimiter, listFavoriteProfessionals);
router.post("/favorites/professionals/:memberId", strictLimiter, addFavoriteProfessional);
router.delete("/favorites/professionals/:memberId", strictLimiter, removeFavoriteProfessional);

router.get("/favorites/ids", apiLimiter, listFavoriteIds);
router.get("/favorites", apiLimiter, listFavorites);
router.post("/favorites/:studioId", strictLimiter, addFavorite);
router.delete("/favorites/:studioId", strictLimiter, removeFavorite);

/**
 * View recording uses apiLimiter (100/min), not strictLimiter (20/min): this
 * fires on every business/professional page open, so a customer clicking
 * briskly through discovery rails would trip a 20/min cap during ordinary
 * browsing. It isn't a sensitive endpoint - it's bookkeeping.
 */
router.get("/recently-viewed/professionals", apiLimiter, listRecentlyViewedProfessionals);
router.post("/recently-viewed/professionals/:memberId", apiLimiter, recordProfessionalView);

router.get("/recently-viewed", apiLimiter, listRecentlyViewed);
router.delete("/recently-viewed", strictLimiter, clearRecentlyViewed);
router.post("/recently-viewed/:studioId", apiLimiter, recordBusinessView);

export default router;
