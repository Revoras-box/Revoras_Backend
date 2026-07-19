import express from "express";
import { adminLogin, getAdminProfile, createAdmin, getAdmins } from "../controllers/admin.controller.js";
import {
  listBusinesses,
  getBusiness,
  updateBusiness,
  approveBusiness,
  rejectBusiness,
  suspendBusiness,
  geocodeBusiness,
  setFeatured,
} from "../controllers/adminBusiness.controller.js";
import {
  listQueue as listVerificationQueue,
  getRequest as getVerificationRequest,
  startReview as startVerificationReview,
  approve as approveVerification,
  reject as rejectVerification,
  suspend as suspendVerification,
  requestMoreInfo as requestVerificationInfo,
  reviewDocument as reviewVerificationDocument,
  addNote as addVerificationNote,
} from "../controllers/adminVerification.controller.js";
import { listUsers, suspendUser, activateUser } from "../controllers/adminUser.controller.js";
import {
  listCollections,
  getCollection,
  previewCollection,
  createCollection,
  updateCollection,
  deleteCollection,
  duplicateCollection,
  pinBusiness,
  unpinBusiness,
  reorderItems,
} from "../controllers/adminCollection.controller.js";
import { getDashboard } from "../controllers/adminDashboard.controller.js";
import { getAnalytics } from "../controllers/adminAnalytics.controller.js";
import { listActivity } from "../controllers/adminActivityLog.controller.js";
import { authenticateAdmin, requireAdmin } from "../middlewares/auth.middleware.js";
import { apiLimiter, authLimiter, authFloodLimiter, floodLimiter } from "../middlewares/rateLimit.middleware.js";

/**
 * Phase 2.5 (report.md Phase 2 plan) - admin fully migrated onto
 * routes -> controllers -> services -> repositories -> Knex, same as every
 * other domain, but deliberately isolated from the Business permission
 * model: authenticateAdmin/requireAdmin are a separate two-tier
 * (admin/super_admin) check against the `admins` table, not
 * requireBusinessMember/requirePermission's role_permissions system.
 *
 * Path segments renamed /studios* -> /businesses* ("remove all remaining
 * references to old Studio tables") - safe outright, this controller only
 * ever queried the dropped studios/studio_owners/barbers tables before this
 * phase, so there was no working frontend integration to preserve (same
 * reasoning as Phase 2.4's discovery rename).
 */
const router = express.Router();

// Per-IP flood ceiling in front of everything, including the login handler.
router.use(floodLimiter);

// Admin login (tighter limit than the general apiLimiter, given the blast radius of a compromised admin account)
router.post("/login", authFloodLimiter, authLimiter, adminLogin);

router.use(authenticateAdmin);
router.use(requireAdmin);

// Only now does req.user exist, so apiLimiter can bill per admin rather than
// per IP (it ran before authenticateAdmin previously, so it never could).
router.use(apiLimiter);

router.get("/me", getAdminProfile);

router.get("/dashboard", getDashboard);
router.get("/analytics", getAnalytics);
router.get("/activity-log", listActivity);

router.get("/businesses", listBusinesses);
router.get("/businesses/:id", getBusiness);
router.put("/businesses/:id", updateBusiness);
router.post("/businesses/:id/approve", approveBusiness);
router.post("/businesses/:id/reject", rejectBusiness);
router.post("/businesses/:id/suspend", suspendBusiness);
router.post("/businesses/:id/geocode", geocodeBusiness);
router.patch("/businesses/:id/featured", setFeatured);

// Phase 2.2 (Discovery Curation System) - Collections Manager. Static
// sub-paths (/items/reorder) registered before the generic /:id routes below
// them isn't a concern here since Express matches the most specific literal
// segment first regardless of declaration order for non-overlapping patterns,
// but /items/:businessId is still declared after /items so DELETE resolves correctly.
router.get("/collections", listCollections);
router.post("/collections", createCollection);
router.get("/collections/:id", getCollection);
router.get("/collections/:id/preview", previewCollection);
router.patch("/collections/:id", updateCollection);
router.delete("/collections/:id", deleteCollection);
router.post("/collections/:id/duplicate", duplicateCollection);
router.post("/collections/:id/items", pinBusiness);
router.patch("/collections/:id/items/reorder", reorderItems);
router.delete("/collections/:id/items/:businessId", unpinBusiness);

// Phase 1.4b - verification queue. All admin-only (already behind
// authenticateAdmin/requireAdmin above). Static /verifications path is
// distinct from /businesses, so no ordering hazard.
router.get("/verifications", listVerificationQueue);
router.get("/verifications/:id", getVerificationRequest);
router.post("/verifications/:id/review", startVerificationReview);
router.post("/verifications/:id/approve", approveVerification);
router.post("/verifications/:id/reject", rejectVerification);
router.post("/verifications/:id/suspend", suspendVerification);
router.post("/verifications/:id/request-info", requestVerificationInfo);
router.patch("/verifications/:id/documents/:documentId", reviewVerificationDocument);
router.post("/verifications/:id/notes", addVerificationNote);

router.get("/users", listUsers);
router.patch("/users/:id/suspend", suspendUser);
router.patch("/users/:id/activate", activateUser);

// Super-admin only (enforced in admin.service.js, not here)
router.get("/admins", getAdmins);
router.post("/admins", createAdmin);

export default router;
