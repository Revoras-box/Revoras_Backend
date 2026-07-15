import express from "express";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { resolveOwnMembership } from "../middlewares/businessMember.middleware.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";
import { uploadSingle } from "../middlewares/upload.middleware.js";
import { getMyProfile, updateMyProfile } from "../controllers/me.controller.js";
import {
  listPortfolio,
  addPortfolioImage,
  removePortfolioImage,
  reorderPortfolio,
  setCoverImage,
  updatePortfolioCaption,
} from "../controllers/portfolio.controller.js";
import {
  listCertificates,
  addCertificate,
  updateCertificate,
  removeCertificate,
} from "../controllers/certificate.controller.js";

/**
 * Phase 1.3c - Professional Self-Service. Every route resolves the caller's OWN
 * membership from the authenticated user + `studioId` (query) via
 * resolveOwnMembership, which sets req.params.studioId/memberId. The existing
 * portfolio/certificate controllers are reused unchanged - a professional
 * managing their own media is the same operation as an owner managing it, only
 * the member resolution differs. Profile edits are restricted to self-editable
 * fields by updateOwnProfileSchema in the controller.
 *
 * studioId is always a query param (uniform across JSON and multipart requests),
 * so resolveOwnMembership can run after multer without depending on body parsing.
 */
const router = express.Router();

router.use(apiLimiter, authenticate);

router.get("/profile", resolveOwnMembership, getMyProfile);
router.patch("/profile", resolveOwnMembership, updateMyProfile);

router.get("/portfolio", resolveOwnMembership, listPortfolio);
router.post("/portfolio", uploadSingle("file"), resolveOwnMembership, addPortfolioImage);
router.patch("/portfolio/reorder", resolveOwnMembership, reorderPortfolio);
router.patch("/portfolio/:imageId/cover", resolveOwnMembership, setCoverImage);
router.patch("/portfolio/:imageId", resolveOwnMembership, updatePortfolioCaption);
router.delete("/portfolio/:imageId", resolveOwnMembership, removePortfolioImage);

router.get("/certificates", resolveOwnMembership, listCertificates);
router.post("/certificates", uploadSingle("file"), resolveOwnMembership, addCertificate);
router.patch("/certificates/:certId", uploadSingle("file"), resolveOwnMembership, updateCertificate);
router.delete("/certificates/:certId", resolveOwnMembership, removeCertificate);

export default router;
