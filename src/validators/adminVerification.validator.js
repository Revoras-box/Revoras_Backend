import { z } from "zod";

// Phase 1.4b - admin verification-queue payloads.

export const listQueueQuerySchema = z.object({
  status: z.enum(["draft", "submitted", "under_review", "more_info", "approved", "rejected", "suspended"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const approveSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const reasonSchema = z.object({
  reason: z.string().min(1).max(1000),
});

export const reviewDocumentSchema = z.object({
  status: z.enum(["accepted", "rejected"]),
  note: z.string().max(1000).optional(),
});

export const addNoteSchema = z.object({
  note: z.string().min(1).max(2000),
});
