import { z } from "zod";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");

// GET /api/business/:studioId/payments
export const listBusinessPaymentsQuerySchema = z.object({
  status: z.enum(["pending", "paid", "failed", "refunded"]).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
