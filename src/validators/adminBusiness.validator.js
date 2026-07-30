import { z } from "zod";
import { httpUrl } from "./url.validator.js";

export const listBusinessesQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "suspended"]).optional(),
  search: z.string().max(255).optional(),
  sortBy: z.enum(["created_at", "name", "rating", "approval_status"]).default("created_at"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const updateBusinessSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  address: z.string().min(1).max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: z.string().max(32).optional(),
  email: z.string().email().optional(),
  description: z.string().max(5000).optional(),
  imageUrl: httpUrl.optional(),
  adminNotes: z.string().max(2000).optional(),
  amenities: z.array(z.string()).optional(),
});

export const approveBusinessSchema = z.object({
  adminNotes: z.string().max(2000).optional(),
});

export const rejectBusinessSchema = z.object({
  reason: z.string().min(1).max(1000),
  adminNotes: z.string().max(2000).optional(),
});

export const suspendBusinessSchema = z.object({
  reason: z.string().max(1000).optional(),
  adminNotes: z.string().max(2000).optional(),
});

export const geocodeBusinessSchema = z.object({
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
});

// Phase 2.2 (Discovery Curation System) - Featured Businesses.
export const setFeaturedSchema = z.object({
  isFeatured: z.boolean(),
  priority: z.coerce.number().int().min(0).max(8).optional(),
  startAt: z.coerce.date().optional().nullable(),
  endAt: z.coerce.date().optional().nullable(),
  region: z.string().max(100).optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
});
