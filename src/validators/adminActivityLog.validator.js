import { z } from "zod";

export const listActivityQuerySchema = z.object({
  adminId: z.string().uuid().optional(),
  action: z.string().max(255).optional(),
  entityType: z.string().max(100).optional(),
  entityId: z.string().uuid().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
