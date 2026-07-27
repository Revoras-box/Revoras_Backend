import { z } from "zod";

const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "must be HH:MM or HH:MM:SS");

export const replaceMemberWorkingHoursSchema = z
  .object({
    // True means "delete this member's rota and inherit the shop's hours", so
    // `days` is not required alongside it.
    followsBusinessHours: z.boolean().default(false),
    days: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          startTime: timeStr.nullable().optional(),
          endTime: timeStr.nullable().optional(),
          isOff: z.boolean().default(false),
        })
      )
      .optional(),
  })
  .refine((body) => body.followsBusinessHours || (body.days?.length ?? 0) > 0, {
    message: "Provide days, or set followsBusinessHours to true",
    path: ["days"],
  });
