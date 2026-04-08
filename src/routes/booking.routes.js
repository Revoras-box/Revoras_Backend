import express from "express";
import {
  createBooking,
  getUserBookings,
  getBookingById,
  cancelBooking,
  rescheduleBooking,
  getAvailability
} from "../controller/booking.controller.js";
import { authenticateToken, requireUser } from "../middlewares/auth.middleware.js";
import { apiLimiter, strictLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

// Public route - check availability
router.get("/availability", apiLimiter, getAvailability);

// Protected routes - require authenticated user
router.use(authenticateToken);
router.use(requireUser);

// Create new booking
router.post("/", strictLimiter, createBooking);

// Get user's bookings
router.get("/", apiLimiter, getUserBookings);

// Get specific booking
router.get("/:id", apiLimiter, getBookingById);

// Cancel booking
router.put("/:id/cancel", strictLimiter, cancelBooking);

// Reschedule booking
router.put("/:id/reschedule", strictLimiter, rescheduleBooking);

export default router;
