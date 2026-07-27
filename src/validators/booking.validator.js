import { z } from "zod";

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "must be HH:MM or HH:MM:SS");

export const createBookingSchema = z.object({
  studioId: uuid,
  businessMemberId: uuid,
  serviceIds: z.array(uuid).min(1),
  date: dateStr,
  startTime: timeStr,
  notes: z.string().max(1000).optional(),
});

// Phase 2.4 - booking price/offer preview (no date/time needed; the discount
// depends only on business + services + the customer).
export const quoteBookingSchema = z.object({
  studioId: uuid,
  serviceIds: z.array(uuid).min(1),
  // Optional: the wizard quotes before a professional is chosen (catalogue
  // estimate) and again after (that professional's own durations and prices).
  businessMemberId: uuid.optional(),
});

export const cancelBookingSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const rescheduleBookingSchema = z.object({
  date: dateStr,
  startTime: timeStr,
});

/**
 * Comma-separated UUIDs in a query string ("?serviceIds=a,b") -> string[].
 * Also tolerates the repeated-key form ("?serviceIds=a&serviceIds=b"), which
 * URLSearchParams produces and Express hands over as an array.
 */
const uuidListParam = z.preprocess((value) => {
  if (value === undefined || value === "") return undefined;
  if (Array.isArray(value)) return value;
  return String(value).split(",").map((part) => part.trim()).filter(Boolean);
}, z.array(uuid).min(1).optional());

export const availabilityQuerySchema = z.object({
  businessMemberId: uuid,
  date: dateStr,
  // Preferred over `duration`: the server sums the real service durations, so
  // the grid can't offer a slot the booking endpoint would reject for length.
  serviceIds: uuidListParam,
  duration: z.coerce.number().int().positive().optional(),
  studioId: uuid.optional(),
});

// GET /api/bookings/availability/calendar - which upcoming days have capacity.
export const availabilityCalendarQuerySchema = z.object({
  businessMemberId: uuid,
  from: dateStr.optional(),
  days: z.coerce.number().int().positive().max(90).default(14),
  serviceIds: uuidListParam,
  duration: z.coerce.number().int().positive().optional(),
  studioId: uuid.optional(),
});

// GET /api/business/:studioId/availability - every professional's slots on a date.
export const teamAvailabilityQuerySchema = z.object({
  date: dateStr,
  serviceIds: uuidListParam,
  duration: z.coerce.number().int().positive().optional(),
});

export const listBookingsQuerySchema = z.object({
  status: z.string().optional(),
  category: z.enum(["upcoming", "past", "cancelled"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

// GET /api/business/:studioId/bookings
export const listBusinessBookingsQuerySchema = z.object({
  search: z.string().max(255).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  businessMemberId: uuid.optional(),
  status: z.string().optional(),
  paymentStatus: z.enum(["unpaid", "pending", "paid", "failed", "refunded"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// PATCH /api/business/:studioId/bookings/:id - reschedule and/or reassign professional
export const businessRescheduleSchema = z
  .object({
    bookingDate: dateStr.optional(),
    startTime: timeStr.optional(),
    businessMemberId: uuid.optional(),
  })
  .refine((v) => v.bookingDate || v.startTime || v.businessMemberId, {
    message: "At least one of bookingDate, startTime, or businessMemberId is required",
  });

// PATCH /api/business/:studioId/bookings/:id/status
// Phase 2.5 - the business-initiated targets. `checked_in` added; the state
// machine (bookingStateMachine.js) decides which are legal FROM the booking's
// current status - this only bounds the input to known statuses.
export const updateBookingStatusSchema = z.object({
  status: z.enum(["confirmed", "checked_in", "completed", "cancelled", "no_show"]),
  reason: z.string().max(500).optional(),
});
