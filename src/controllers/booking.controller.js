import * as bookingService from "../services/booking.service.js";
import * as availabilityService from "../services/availability.service.js";
import {
  createBookingSchema,
  cancelBookingSchema,
  rescheduleBookingSchema,
  availabilityQuerySchema,
  availabilityCalendarQuerySchema,
  listBookingsQuerySchema,
  listBusinessBookingsQuerySchema,
  businessRescheduleSchema,
  updateBookingStatusSchema,
  quoteBookingSchema,
} from "../validators/booking.validator.js";

// POST /api/bookings
export const createBooking = async (req, res) => {
  const input = createBookingSchema.parse(req.body);
  const booking = await bookingService.createBooking({ userId: req.user.id, ...input });
  res.status(201).json({ message: "Booking created successfully", booking });
};

// POST /api/bookings/quote — price + applicable offer preview, no booking created
export const quoteBooking = async (req, res) => {
  const { studioId, serviceIds, businessMemberId } = quoteBookingSchema.parse(req.body);
  const quote = await bookingService.quoteBooking({ userId: req.user.id, studioId, serviceIds, businessMemberId });
  res.json({ quote });
};

// GET /api/bookings
export const getUserBookings = async (req, res) => {
  const query = listBookingsQuerySchema.parse(req.query);
  const result = await bookingService.getUserBookings(req.user.id, query);
  res.json(result);
};

// GET /api/bookings/:id
export const getBookingById = async (req, res) => {
  const booking = await bookingService.getBookingDetail(req.params.id, req.user.id);
  res.json({ booking });
};

// GET /api/bookings/:id/timeline — the booking's status-event history
export const getBookingTimeline = async (req, res) => {
  // getBookingDetail enforces ownership; reuse it as the access check.
  await bookingService.getBookingDetail(req.params.id, req.user.id);
  const timeline = await bookingService.getBookingTimeline(req.params.id);
  res.json({ timeline });
};

// GET /api/bookings/:id/cancellation-quote — policy outcome without cancelling
export const getCancellationQuote = async (req, res) => {
  const quote = await bookingService.getCancellationQuote(req.params.id, req.user.id);
  res.json({ quote });
};

// PATCH /api/bookings/:id/cancel
export const cancelBooking = async (req, res) => {
  const { reason } = cancelBookingSchema.parse(req.body);
  await bookingService.cancelBooking(req.params.id, req.user.id, reason);
  res.json({ message: "Booking cancelled successfully" });
};

// PATCH /api/bookings/:id/reschedule
export const rescheduleBooking = async (req, res) => {
  const input = rescheduleBookingSchema.parse(req.body);
  await bookingService.rescheduleBooking(req.params.id, req.user.id, input);
  res.json({ message: "Booking rescheduled successfully" });
};

// GET /api/bookings/availability
export const getAvailability = async (req, res) => {
  const query = availabilityQuerySchema.parse(req.query);
  const result = await availabilityService.getAvailability(query);
  res.json(result);
};

// GET /api/bookings/availability/calendar - per-day capacity for a date range,
// so the date strip can grey out days with nothing free instead of making the
// customer tap through them one at a time.
export const getAvailabilityCalendar = async (req, res) => {
  const query = availabilityCalendarQuerySchema.parse(req.query);
  const result = await availabilityService.getAvailabilityCalendar(query);
  res.json(result);
};

// GET /api/business/:studioId/bookings
export const listBusinessBookings = async (req, res) => {
  const query = listBusinessBookingsQuerySchema.parse(req.query);
  const result = await bookingService.listBusinessBookings(req.params.studioId, query);
  res.json(result);
};

// PATCH /api/business/:studioId/bookings/:id
export const rescheduleBusinessBooking = async (req, res) => {
  const input = businessRescheduleSchema.parse(req.body);
  await bookingService.rescheduleBusinessBooking(req.params.studioId, req.params.id, input);
  res.json({ message: "Booking updated successfully" });
};

// PATCH /api/business/:studioId/bookings/:id/status
export const updateBusinessBookingStatus = async (req, res) => {
  const { status, reason } = updateBookingStatusSchema.parse(req.body);
  await bookingService.updateBusinessBookingStatus(req.params.studioId, req.params.id, status, req.user.id, reason);
  res.json({ message: "Booking status updated successfully" });
};
