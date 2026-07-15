import * as trustRepo from "../repositories/trust.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Weighted 0-100 trust score. Weights sum to 100; each component is clamped so a
// single dimension can't dominate. `verified` is 0 until Phase 1.4b/1.4c grants
// it. Kept as pure functions of the metrics so the score is reproducible.
const TRUST_WEIGHTS = { rating: 20, reviews: 10, completed: 15, cancellation: 12, noShow: 8, profile: 15, verification: 10, age: 5, response: 5 };

export const computeScore = (m) => {
  const responseComponent =
    m.avg_response_minutes == null ? TRUST_WEIGHTS.response : clamp01(1 - m.avg_response_minutes / 120) * TRUST_WEIGHTS.response;
  return Math.round(
    clamp01(m.rating / 5) * TRUST_WEIGHTS.rating +
      clamp01(m.review_count / 50) * TRUST_WEIGHTS.reviews +
      clamp01(m.completed_bookings / 100) * TRUST_WEIGHTS.completed +
      clamp01(1 - m.cancellation_rate) * TRUST_WEIGHTS.cancellation +
      clamp01(1 - m.no_show_rate) * TRUST_WEIGHTS.noShow +
      (m.profile_completion / 100) * TRUST_WEIGHTS.profile +
      (m.verified ? TRUST_WEIGHTS.verification : 0) +
      clamp01(m.business_age_days / 365) * TRUST_WEIGHTS.age +
      responseComponent
  );
};

// Business-level profile completion (distinct from a professional's). 10 checks.
export const computeBusinessProfileCompletion = (biz, { gallery, services, staff, openHours }) => {
  const checks = [
    !!biz.description,
    gallery > 0,
    services > 0,
    staff > 0,
    openHours > 0,
    Object.keys(biz.social_links ?? {}).length > 0,
    Object.keys(biz.policies ?? {}).length > 0,
    (biz.languages?.length ?? 0) > 0,
    (biz.payment_methods?.length ?? 0) > 0,
    (biz.amenities?.length ?? 0) > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

export const scoreBand = (score) => {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Great";
  if (score >= 60) return "Good";
  if (score >= 40) return "Fair";
  return "Building";
};

export const recomputeTrustScore = async (businessId) => {
  const [stats, biz, gallery, services, staff, openHours, verified] = await Promise.all([
    trustRepo.bookingStats(businessId),
    trustRepo.businessRow(businessId),
    trustRepo.galleryCount(businessId),
    trustRepo.activeServiceCount(businessId),
    trustRepo.activeStaffCount(businessId),
    trustRepo.openHoursCount(businessId),
    trustRepo.isVerified(businessId),
  ]);
  if (!biz) throw new ServiceError(404, "Business not found");

  const total = stats.total || 0;
  const avgResponse = stats.avg_response_minutes == null ? null : Math.round(Number(stats.avg_response_minutes));
  const metrics = {
    rating: Number(biz.rating) || 0,
    review_count: biz.review_count || 0,
    completed_bookings: stats.completed || 0,
    cancellation_rate: total ? stats.cancelled / total : 0,
    no_show_rate: total ? stats.no_show / total : 0,
    profile_completion: computeBusinessProfileCompletion(biz, { gallery, services, staff, openHours }),
    avg_response_minutes: avgResponse,
    business_age_days: Math.max(0, Math.floor((Date.now() - new Date(biz.created_at).getTime()) / 86400000)),
    verified, // Phase 1.4b: true iff an approved verification request exists; feeds the verification weight
  };

  const row = { business_id: businessId, score: computeScore(metrics), ...metrics, computed_at: new Date() };
  await trustRepo.upsert(row);
  return row;
};

// Phase 1.4c: does this business hold an approved verification? (thin pass-
// through so callers depend on the service, not the repository.)
export const isBusinessVerified = (businessId) => trustRepo.isVerified(businessId);

// Cached read; computes+caches once on a miss. Adds a display band.
export const getTrustSignals = async (businessId) => {
  const row = (await trustRepo.get(businessId)) || (await recomputeTrustScore(businessId));
  return { ...row, band: scoreBand(row.score) };
};
