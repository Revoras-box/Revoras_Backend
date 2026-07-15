import { z } from "zod";

export const createReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(255).optional(),
  comment: z.string().max(2000).optional(),
  photos: z.array(z.string().url()).max(10).default([]),
});

export const updateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().max(255).optional(),
  comment: z.string().max(2000).optional(),
  photos: z.array(z.string().url()).max(10).optional(),
});

export const listReviewsQuerySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  sortBy: z.enum(["recent", "highest", "lowest", "helpful"]).default("recent"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});
