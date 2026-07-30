import { z } from "zod";
import { httpUrl } from "./url.validator.js";

const uuid = z.string().uuid();
// Scheme-restricted, not just well-formed - see url.validator.js.
const url = httpUrl;

// Phase 1.2 - known social platforms. Non-strict: unknown keys are stripped by
// Zod's default object behavior rather than rejected, so adding a platform later
// is backend-forward-compatible. Values are free strings (handles or URLs vary),
// not strictly url() - a WhatsApp entry may be a phone number.
const socialLinksSchema = z
  .object({
    instagram: z.string().max(500),
    facebook: z.string().max(500),
    twitter: z.string().max(500),
    youtube: z.string().max(500),
    tiktok: z.string().max(500),
    linkedin: z.string().max(500),
    whatsapp: z.string().max(500),
  })
  .partial();

const policiesSchema = z
  .object({
    cancellation: z.string().max(2000),
    rescheduling: z.string().max(2000),
    refund: z.string().max(2000),
    general: z.string().max(2000),
  })
  .partial();

// Phase 2.5+ - the structured cancellation/refund policy the engine
// (cancellationPolicy.service.js) evaluates. `tiers` is "cancel at least
// `hoursBefore` ahead → get `refundPercent` back"; the customer gets the highest
// tier they clear. `noCancelWithinHours` is the hard cutoff after which a
// booking can't be cancelled at all. Unknown/legacy keys (freeBeforeHours,
// feePercentAfter) are stripped here but still understood by the engine's
// backward-compatible normalizer for rows written before this shape existed.
const cancellationPolicySchema = z.object({
  tiers: z
    .array(
      z.object({
        hoursBefore: z.number().min(0).max(8760),
        refundPercent: z.number().min(0).max(100),
      })
    )
    .max(10)
    .optional(),
  noCancelWithinHours: z.number().min(0).max(168).optional(),
});

/**
 * The owner's Reschedule Protection terms, evaluated by
 * reschedulePolicy.service.js. `enabled` decides whether the add-on is offered at
 * checkout at all; `feeAmount` is what it costs; `cutoffHours` is how close to the
 * appointment a protected booking can still be moved; `maxReschedules` is how many
 * moves one purchase buys.
 *
 * The upper bounds are deliberately generous rather than opinionated (a studio may
 * legitimately want a week's notice), but `cutoffHours` is capped below the 8760h
 * allowed elsewhere because a cutoff longer than a year would mean no booking is
 * ever reschedulable.
 */
const reschedulePolicySchema = z.object({
  enabled: z.boolean().optional(),
  feeAmount: z.number().min(0).max(100000).optional(),
  cutoffHours: z.number().min(0).max(168).optional(),
  maxReschedules: z.number().int().min(1).max(10).optional(),
});

const businessProfileFields = {
  name: z.string().min(1).max(255),
  categoryId: uuid.nullable().optional(),
  address: z.string().min(1).max(500),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: z.string().max(32).optional(),
  email: z.string().email().max(255).optional(),
  description: z.string().max(5000).optional(),
  imageUrl: url.optional(),
  logoUrl: url.optional(),
  bannerUrl: url.optional(),
  amenities: z.array(z.string()).optional(),
  // Phase 1.2 - Business Information & Trust Layer. website nullable so an owner
  // can clear it; the array/object fields default to []/{} at the DB level.
  website: url.nullable().optional(),
  socialLinks: socialLinksSchema.optional(),
  languages: z.array(z.string().max(100)).max(50).optional(),
  paymentMethods: z.array(z.string().max(100)).max(50).optional(),
  policies: policiesSchema.optional(),
  cancellationPolicy: cancellationPolicySchema.optional(),
  reschedulePolicy: reschedulePolicySchema.optional(),
  accessibility: z.array(z.string().max(200)).max(50).optional(),
  houseRules: z.array(z.string().max(500)).max(50).optional(),
};

export const createBusinessSchema = z.object({
  ...businessProfileFields,
  designation: z.string().max(100).optional(),
  providesServices: z.boolean().default(true),
});

export const updateBusinessSchema = z.object(businessProfileFields).partial();
