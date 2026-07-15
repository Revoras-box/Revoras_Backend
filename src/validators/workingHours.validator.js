import { z } from "zod";

const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "must be HH:MM or HH:MM:SS");

export const replaceWorkingHoursSchema = z.object({
  days: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        openTime: timeStr.nullable().optional(),
        closeTime: timeStr.nullable().optional(),
        isClosed: z.boolean().default(false),
      })
    )
    .min(1),
});
