import { z } from "zod";

// Phase 2.1 (Advanced Filters) - comma-separated list params (amenities,
// paymentMethods, languages), same free-text convention the business-profile
// forms already use for these fields (see business.validator.js). Kept as a
// plain string here and split in discovery.repository.js rather than adding
// validator-level array parsing, since the underlying data is uncontrolled
// free text anyway (an owner-entered comma list) - validating structure here
// would just be false precision.
const csv = z.string().max(500).optional();

/**
 * Query-string boolean flags. `z.coerce.boolean()` is just `Boolean(value)`,
 * and every non-empty string is truthy - so `?verifiedOnly=false` coerced to
 * `true` and filtered *to* verified-only businesses (returning zero results),
 * exactly inverting the caller's intent. Only the literal "true"/"1" mean true
 * here; anything else is false, and nothing throws, so no previously-accepted
 * query string starts 400ing.
 */
const boolFlag = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => (typeof v === "string" ? v === "true" || v === "1" : v));

export const listBusinessesQuerySchema = z.object({
  search: z.string().max(255).optional(),
  categoryId: z.string().uuid().optional(),
  city: z.string().max(100).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(200).optional(),
  // Phase 2 (Discovery Experience) added popular/trending/newest; Phase 2.1
  // (Advanced Filters) added priceLow/priceHigh (aggregated from active
  // service prices - businesses don't have a single price) and
  // fastestResponse (trust_scores.avg_response_minutes, already computed).
  sortBy: z
    .enum([
      "recommended",
      "rating",
      "distance",
      "reviews",
      "name",
      "popular",
      "trending",
      "newest",
      "priceLow",
      "priceHigh",
      "fastestResponse",
    ])
    .default("recommended"),
  // "Open Now"/"Open Today" are hard correctness filters (a closed business
  // shouldn't appear regardless of sort), not sortBy values. Open Today
  // ignores the current time (any non-closed hours today), Open Now doesn't.
  openNow: boolFlag,
  openToday: boolFlag,
  // Phase 2.1 (Advanced Filters) - all query-only, no new schema. Reuses
  // trust_scores.verified/business_subscriptions (Phase 2's premium join) and
  // the existing businesses.amenities/payment_methods/languages jsonb arrays.
  minRating: z.coerce.number().min(0).max(5).optional(),
  priceMin: z.coerce.number().min(0).optional(),
  priceMax: z.coerce.number().min(0).optional(),
  serviceCategoryId: z.string().uuid().optional(),
  amenities: csv,
  paymentMethods: csv,
  languages: csv,
  accessibility: csv,
  verifiedOnly: boolFlag,
  premiumOnly: boolFlag,
  // Phase 2.2 (Discovery Curation System) - powers the "Featured Businesses"
  // homepage rail and /user/search?featuredOnly=true. discovery.service.js and
  // discovery.repository.js already read this flag; it was missing here, and
  // since this schema strips unknown keys the param never survived validation,
  // so the filter silently no-op'd and the rail returned unfeatured businesses.
  featuredOnly: boolFlag,
  // Phase 2.4 (Offers & Promotions) - "Has Offers" filter + the Offers rail.
  // Uses boolFlag, not z.coerce.boolean(), for the same reason as the flags
  // above (see the boolFlag comment).
  hasOffers: boolFlag,
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(20),
});

export const mapQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(200).optional(),
  minLat: z.coerce.number().optional(),
  maxLat: z.coerce.number().optional(),
  minLng: z.coerce.number().optional(),
  maxLng: z.coerce.number().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});
