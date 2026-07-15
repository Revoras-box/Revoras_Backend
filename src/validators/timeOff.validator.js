import { z } from "zod";

const uuid = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "must be HH:MM or HH:MM:SS");

export const createTimeOffSchema = z.object({
  // Optional: staff booking their own time off don't need to supply it - the
  // controller fills it in from the authenticated membership (see timeOff.controller.js).
  businessMemberId: uuid.optional(),
  date: dateStr,
  startTime: timeStr.optional(),
  endTime: timeStr.optional(),
  isFullDay: z.boolean().default(false),
  reason: z.string().max(500).optional(),
});

export const listTimeOffQuerySchema = z.object({
  businessMemberId: uuid.optional(),
  date: dateStr.optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
});
