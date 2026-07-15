import express from "express";
import {
  createBooking,
  quoteBooking,
  getUserBookings,
  getBookingById,
  getBookingTimeline,
  getCancellationQuote,
  cancelBooking,
  rescheduleBooking,
  getAvailability,
} from "../controllers/booking.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { apiLimiter, strictLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

// Public route - check availability
router.get("/availability", apiLimiter, getAvailability);

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
router.patch("/:id/reschedule", strictLimiter, rescheduleBooking);

export default router;
