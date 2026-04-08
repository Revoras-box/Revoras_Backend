import express from "express";
import {
  createReview,
  getStudioReviews,
  getBarberReviews,
  markHelpful,
  getMyReviews
} from "../controller/review.controller.js";
import { authenticateToken, requireUser, optionalAuth } from "../middlewares/auth.middleware.js";
import { apiLimiter, strictLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

// Public routes - get reviews
router.get("/studio/:studioId", optionalAuth, apiLimiter, getStudioReviews);
router.get("/barber/:barberId", optionalAuth, apiLimiter, getBarberReviews);

// Protected routes
router.use(authenticateToken);
router.use(requireUser);

// Get my reviews
router.get("/me", apiLimiter, getMyReviews);

// Create review
router.post("/", strictLimiter, createReview);

// Mark review as helpful
router.post("/:id/helpful", strictLimiter, markHelpful);

export default router;
