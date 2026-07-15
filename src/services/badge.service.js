/**
 * Phase 1.4c - the badge engine. Badges are DERIVED (not stored in a table)
 * from signals already cached on `trust_scores` / `businesses` /
 * `business_members`. A separate `business_badges` table would be a second
 * cache of facts we already hold, needing its own recompute/sync - the same
 * drift trap the codebase avoids by keeping `trust_scores` as the one cache.
 * So this is a pure function layer: give it the signals, get the badges,
 * always consistent with the underlying data.
 *
 * (Deliberate deviation from report.md's literal "business_badges /
 * professional_badges tables" wording - recorded in report.md §V4.7.)
 */

// Business badge thresholds.
const TOP_RATED_MIN_RATING = 4.5;
const TOP_RATED_MIN_REVIEWS = 10;
const POPULAR_MIN_COMPLETED = 50;
const TRENDING_MIN_RECENT = 10; // bookings in the recent window (see discovery repo)
const NEW_MAX_AGE_DAYS = 30;

// Professional badge thresholds.
const PROFESSIONAL_TOP_MIN_RATING = 4.7;
const EXPERIENCE_TIERS = [
  { key: "master", label: "Master", minYears: 12 },
  { key: "expert", label: "Expert", minYears: 7 },
  { key: "senior", label: "Senior", minYears: 3 },
];

/**
 * @param signals { verified, premium, featured, rating, reviewCount,
 *                  completedBookings, businessAgeDays, recentBookings }
 * @returns array of { key, label } ordered by prominence.
 */
export const computeBusinessBadges = ({
  verified = false,
  premium = false,
  featured = false,
  rating = 0,
  reviewCount = 0,
  completedBookings = 0,
  businessAgeDays = 0,
  recentBookings = 0,
} = {}) => {
  const badges = [];
  if (verified) badges.push({ key: "verified", label: "Verified" });
  // Phase 2.2 - editorial curation, distinct from the subscription-driven
  // "premium" badge (a business can be featured without being premium, or
  // vice versa - they're independent admin/owner-controlled signals).
  if (featured) badges.push({ key: "featured", label: "Featured" });
  if (premium) badges.push({ key: "premium", label: "Premium" });
  if (rating >= TOP_RATED_MIN_RATING && reviewCount >= TOP_RATED_MIN_REVIEWS) {
    badges.push({ key: "top_rated", label: "Top Rated" });
  }
  if (completedBookings >= POPULAR_MIN_COMPLETED) badges.push({ key: "popular", label: "Popular" });
  if (recentBookings >= TRENDING_MIN_RECENT) badges.push({ key: "trending", label: "Trending" });
  if (businessAgeDays <= NEW_MAX_AGE_DAYS) badges.push({ key: "new", label: "New" });
  return badges;
};

/**
 * @param signals { businessVerified, rating, experienceYears }
 * @returns array of { key, label }. At most one experience-tier badge (the
 *          highest the professional qualifies for).
 */
export const computeProfessionalBadges = ({ businessVerified = false, rating = 0, experienceYears = 0 } = {}) => {
  const badges = [];
  if (businessVerified) badges.push({ key: "verified_professional", label: "Verified Professional" });
  if (rating >= PROFESSIONAL_TOP_MIN_RATING) badges.push({ key: "top", label: "Top" });
  const tier = EXPERIENCE_TIERS.find((t) => experienceYears >= t.minYears);
  if (tier) badges.push({ key: tier.key, label: tier.label });
  return badges;
};
