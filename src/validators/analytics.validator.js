import { z } from "zod";

export const analyticsQuerySchema = z.object({
  period: z.enum(["week", "month", "quarter", "year"]).default("month"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});
