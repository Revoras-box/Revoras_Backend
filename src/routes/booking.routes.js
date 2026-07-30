import express from "express";
import {
  createBooking,
  quoteBooking,
  getUserBookings,
  getBookingById,
  getBookingTimeline,
  getCancellationQuote,
  cancelBooking,
  getRescheduleQuote,
  rescheduleBooking,
  getAvailability,
  getAvailabilityCalendar,
} from "../controllers/booking.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { optionalAuth } from "../middlewares/auth.middleware.js";
import { apiLimiter, strictLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

// Public routes - check availability. `/availability/calendar` is declared
// first so it isn't shadowed by the bare `/availability` match.
//
// `optionalAuth` runs first (and before the limiter, so a signed-in customer is
// counted per account rather than per IP): browsing stays anonymous, but a
// customer moving their own booking is identified, which is what lets
// `excludeBookingId` stop their own appointment from blocking the move.
router.get("/availability/calendar", optionalAuth, apiLimiter, getAvailabilityCalendar);
router.get("/availability", optionalAuth, apiLimiter, getAvailability);

// Protected routes - require an authenticated person (report.md Phase 2.3
// plan: the unified `authenticate` middleware, no role check needed since
// every non-admin token is the same `users` identity).
router.use(authenticate);

router.post("/", strictLimiter, createBooking);
router.post("/quote", apiLimiter, quoteBooking);
router.get("/", apiLimiter, getUserBookings);
router.get("/:id", apiLimiter, getBookingById);
router.get("/:id/timeline", apiLimiter, getBookingTimeline);
router.get("/:id/cancellation-quote", apiLimiter, getCancellationQuote);
router.patch("/:id/cancel", strictLimiter, cancelBooking);
router.get("/:id/reschedule-quote", apiLimiter, getRescheduleQuote);
router.patch("/:id/reschedule", strictLimiter, rescheduleBooking);

export default router;
