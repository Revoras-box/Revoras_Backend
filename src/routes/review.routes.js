import express from "express";
import {
  createReview,
  updateReview,
  deleteReview,
  getBusinessReviews,
  getProfessionalReviews,
  getMyReviews,
  markHelpful,
  unmarkHelpful,
} from "../controllers/review.controller.js";
import { optionalAuth } from "../middlewares/auth.middleware.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { apiLimiter, strictLimiter } from "../middlewares/rateLimit.middleware.js";

/**
 * Reviews belong to a Business and (optionally) a Professional, report.md
 * Phase 2.4 plan - path segments renamed from /studio/:id, /barber/:id to
 * /business/:id, /professional/:id ("remove remaining Studio terminology
 * from public APIs"). Safe to rename outright: this controller has been
 * fully broken (dropped tables) since Phase 1, so there's no working
 * frontend integration these paths need to stay compatible with.
 */
const router = express.Router();

// Public - browse reviews
router.get("/business/:studioId", optionalAuth, apiLimiter, getBusinessReviews);
router.get("/professional/:memberId", optionalAuth, apiLimiter, getProfessionalReviews);

// Protected
router.use(authenticate);

router.get("/me", apiLimiter, getMyReviews);
router.post("/", strictLimiter, createReview);
router.patch("/:id", strictLimiter, updateReview);
router.delete("/:id", strictLimiter, deleteReview);
router.post("/:id/helpful", strictLimiter, markHelpful);
router.delete("/:id/helpful", strictLimiter, unmarkHelpful);

export default router;
