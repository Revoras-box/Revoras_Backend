import { z } from "zod";

export const adminAnalyticsQuerySchema = z.object({
  period: z.enum(["week", "month", "quarter", "year"]).default("month"),
});
