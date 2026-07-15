/**
 * Phase 1.4c - discovery ranking. A weighted 0-100 composite that decides the
 * default order of business search results, so listings surface on merit
 * (trust + rating + popularity + proximity) rather than purely sponsored or
 * newest-first.
 *
 * `verified` is deliberately NOT a separate term here - it already contributes
 * to `trustScore` (the verification weight in trust.service.computeScore), so
 * counting it again would double-reward it. `premium` is a subscription-driven
 * boost - real as of Phase 2 (Discovery Experience), computed from whether the
 * business currently has an ACTIVE, non-lapsed `business_subscriptions` row
 * (discovery.repository.js's activePremiumSubquery / hasActivePremium).
 *
 * The location-independent inputs (trustScore, rating, completedBookings) are
 * already cached on `trust_scores`; distance is inherently per-query, so the
 * discovery repository computes this same composite in SQL - built from the
 * exact weights below (imported, not re-typed) so the two can't drift - to keep
 * ordering and pagination in the database. This pure function is the tested,
 * documented source of truth and is what populates each card's `rankScore`.
 */

export const RANK_WEIGHTS = Object.freeze({
  trust: 40, // trust_scores.score (0-100), already folds in verification
  rating: 25, // businesses.rating (0-5)
  popularity: 15, // completed bookings, saturating
  distance: 15, // proximity to the searcher, when a location is given
  premium: 5, // active subscription boost (Phase 2 - real, see module docblock)
});

// Popularity saturates at this many completed bookings (full popularity weight).
export const POPULARITY_SATURATION = 50;
// With no explicit search radius, proximity fades to 0 by this distance.
export const DISTANCE_FALLOFF_KM = 25;

/**
 * Phase 2.2 (Discovery Curation System) - "a configurable featured boost
 * without overriding relevance" (the explicit brief) and "keep the existing
 * ranking algorithm intact". RANK_WEIGHTS above sums to exactly 100 across
 * its 5 terms - adding a 6th weight there would both change that sum and mix
 * an editorially-configured nudge into the same rubric as merit signals.
 * Instead FEATURED_BOOST is a separate additive layer applied on top of the
 * unchanged 0-100 composite: capped low enough (max 8, roughly one premium-
 * weight's worth) that a featured-but-irrelevant business still can't outrank
 * a highly relevant unfeatured one (e.g. featured business at base score 10
 * -> 18, still loses to an unfeatured business at 85). `featuredPriority` is
 * pre-gated to 0 in SQL (discovery.repository.js's featuredBoostSql) unless
 * the business is currently featured (is_featured + within its start/end
 * window + region match), so this function doesn't need to know about dates.
 */
export const FEATURED_BOOST_MAX = 8;

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const computeRankScore = ({
  trustScore = 0,
  rating = 0,
  completedBookings = 0,
  premium = false,
  featuredPriority = 0,
  distanceKm = null,
  radiusKm = null,
} = {}) => {
  const W = RANK_WEIGHTS;
  const falloff = radiusKm || DISTANCE_FALLOFF_KM;

  const trust = clamp01(trustScore / 100) * W.trust;
  const rate = clamp01(rating / 5) * W.rating;
  const popularity = clamp01(completedBookings / POPULARITY_SATURATION) * W.popularity;
  // No location supplied: proximity is unknown, contribute nothing rather than
  // inventing a value (a business isn't penalised for a locationless search).
  const proximity = distanceKm == null ? 0 : clamp01(1 - distanceKm / falloff) * W.distance;
  const premiumBoost = premium ? W.premium : 0;
  const featuredBoost = Math.max(0, Math.min(FEATURED_BOOST_MAX, featuredPriority));

  return Math.round(trust + rate + popularity + proximity + premiumBoost + featuredBoost);
};
