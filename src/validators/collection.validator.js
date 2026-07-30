import { z } from "zod";
import { httpUrl } from "./url.validator.js";

// Phase 2.2 (Discovery Curation System). Field names/semantics mirror the
// Phase 2.1 Advanced Filters params (filterMinRating <-> minRating, etc.) -
// a collection's filter_* columns are resolved through the exact same
// discovery query, so keeping the vocabulary aligned matters.
const collectionFields = {
  title: z.string().min(1).max(255),
  subtitle: z.string().max(500).optional().nullable(),
  slug: z.string().min(1).max(255).optional(),
  coverImageUrl: httpUrl.optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  displayOrder: z.coerce.number().int().optional(),
  isActive: z.boolean().optional(),
  startAt: z.coerce.date().optional().nullable(),
  endAt: z.coerce.date().optional().nullable(),
  targetCity: z.string().max(100).optional().nullable(),
  targetState: z.string().max(100).optional().nullable(),
  filterCategoryId: z.string().uuid().optional().nullable(),
  filterMinRating: z.coerce.number().min(0).max(5).optional().nullable(),
  filterVerifiedOnly: z.boolean().optional(),
  filterPremiumOnly: z.boolean().optional(),
};

export const createCollectionSchema = z.object(collectionFields);
export const updateCollectionSchema = z.object(collectionFields).partial();

export const listCollectionsQuerySchema = z.object({
  search: z.string().max(255).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const resolveQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const listActiveQuerySchema = z.object({
  city: z.string().max(100).optional(),
});

export const pinBusinessSchema = z.object({
  businessId: z.string().uuid(),
});

export const reorderItemsSchema = z.object({
  orderedBusinessIds: z.array(z.string().uuid()).min(1),
});
