import express from "express";
import { createBusiness, getMyBusinesses } from "../controllers/business.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";

/**
 * Only the two routes that genuinely have no :studioId (a business doesn't
 * exist yet at creation time; "mine" is a user-scoped list, not a business
 * profile) live here. Everything :studioId-scoped - business profile
 * read/update/deactivate, members, services, dashboard, analytics - lives in
 * businessOperations.routes.js instead, which already owns the
 * /api/business/:studioId mount point (Phase 2.1). Splitting it that way
 * isn't just style: mounting a SECOND router with its own :studioId route at
 * the same prefix is a real bug, not just untidy - Express matches
 * /api/business/mine against /api/business/:studioId (studioId="mine") if
 * that router is registered first, and router.use() middleware inside it
 * runs unconditionally before route matching even gets a chance to 404.
 * Found and fixed during this phase's own testing.
 */
const router = express.Router();

router.use(apiLimiter);

router.post("/", authenticate, createBusiness);
router.get("/mine", authenticate, getMyBusinesses);

export default router;
