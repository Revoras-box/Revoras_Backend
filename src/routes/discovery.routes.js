import express from "express";
import {
  listBusinesses,
  listForMap,
  getBusiness,
  getBusinessServices,
  getBusinessProfessionals,
  getProfessional,
  listCollections,
  getCollection,
} from "../controllers/discovery.controller.js";
import { optionalAuth } from "../middlewares/auth.middleware.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";

/**
 * Public customer-facing browsing over Business/Professional/Categories
 * (report.md Phase 2.4 plan) - replaces studio.controller.js/studio.routes.js
 * (queried the dropped `studios`/`barbers` tables, 100% broken since Phase 1)
 * and barber.public.routes.js's single GET /api/barbers/:id. Mounted at
 * /api/discover rather than reusing /api/studios - "remove remaining Studio
 * terminology from public APIs," and there's no working frontend integration
 * pinned to the old path to preserve.
 *
 * Route order matters: /businesses/map must come before /businesses/:id, or
 * Express would capture "map" as the :id param.
 */
const router = express.Router();

router.use(optionalAuth, apiLimiter);

router.get("/businesses/map", listForMap);
router.get("/businesses/:id/services", getBusinessServices);
router.get("/businesses/:id/professionals", getBusinessProfessionals);
router.get("/businesses/:id", getBusiness);
router.get("/businesses", listBusinesses);

router.get("/professionals/:id", getProfessional);

// Phase 2.2 (Discovery Curation System) - editorial collections.
router.get("/collections", listCollections);
router.get("/collections/:slug", getCollection);

export default router;
