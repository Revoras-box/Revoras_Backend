import { z } from "zod";
import { httpUrl } from "./url.validator.js";

const serviceFields = {
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  categoryId: z.string().uuid(),
  // Free-text label used only when categoryId is the "Other" category; the
  // service layer ignores/clears it for any real category.
  customCategory: z.string().max(100).optional(),
  price: z.number().positive().max(1000000),
  duration: z.number().int().positive().max(1440),
  // nullable so the owner can clear a previously-set photo (null), set a new one
  // (url), or leave it unchanged (undefined -> skipped by the partial update).
  imageUrl: httpUrl.nullable().optional(),
  isActive: z.boolean().default(true),
};

export const createServiceSchema = z.object(serviceFields);

export const updateServiceSchema = z.object(serviceFields).partial();

export const listServicesQuerySchema = z.object({
  activeOnly: z.coerce.boolean().default(false),
});
