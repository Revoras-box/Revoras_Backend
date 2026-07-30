import { z } from "zod";
import { httpUrl } from "./url.validator.js";

export const createReviewSchema = z.object({
  bookingId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(255).optional(),
  comment: z.string().max(2000).optional(),
  photos: z.array(httpUrl).max(10).default([]),
});

export const updateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  title: z.string().max(255).optional(),
  comment: z.string().max(2000).optional(),
  photos: z.array(httpUrl).max(10).optional(),
});

export const listReviewsQuerySchema = z.object({
  rating: z.coerce.number().int().min(1).max(5).optional(),
  sortBy: z.enum(["recent", "highest", "lowest", "helpful"]).default("recent"),
  // NOT z.coerce.boolean() — that is truthiness on the raw string, so the literal
  // "false" coerces to true and inverts the filter. Phase 2.2 shipped that bug on
  // `featuredOnly`; parse the two legal strings explicitly instead.
  awaitingReply: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export const replyToReviewSchema = z.object({
  reply: z.string().trim().min(1, "Reply can't be empty").max(2000),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});
