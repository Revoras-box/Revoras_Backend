import * as discoveryRepo from "../repositories/discovery.repository.js";
import * as serviceRepo from "../repositories/service.repository.js";
import * as galleryRepo from "../repositories/businessGallery.repository.js";
import * as portfolioRepo from "../repositories/portfolio.repository.js";
import * as certificateRepo from "../repositories/certificate.repository.js";
import * as trustService from "./trust.service.js";
import * as searchService from "./search.service.js";
import * as badgeService from "./badge.service.js";
import * as rankingService from "./ranking.service.js";
import * as offerRepo from "../repositories/offer.repository.js";
import { summarizeOffers, toPublicOffer } from "./offer.engine.js";
import { ServiceError } from "../utils/ServiceError.js";
import { isValidUUID } from "../utils/validation.js";

const DEFAULT_SEARCH_RADIUS_KM = 10;
const DEFAULT_MAP_RADIUS_KM = 25;

const daysSince = (date) => (date ? Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86400000)) : 0);

// Phase 1.4c: decorate a business search row (from discovery.repository, which
// joins trust_scores + recent bookings + Phase 2's active-subscription join)
// with derived badges and its rank score. Exported (Phase 2.2) so
// collection.service.js can reuse it for resolved collection businesses
// instead of re-deriving badges/rankScore a second way.
export const decorateBusinessCard = (row, radiusKm) => {
  const businessAgeDays = daysSince(row.created_at);
  const badges = badgeService.computeBusinessBadges({
    verified: row.verified,
    premium: row.premium,
    featured: row.featured,
    rating: Number(row.rating),
    reviewCount: row.review_count,
    completedBookings: row.completed_bookings,
    businessAgeDays,
    recentBookings: row.recent_bookings,
  });
  const rankScore = rankingService.computeRankScore({
    trustScore: row.trust_score,
    rating: Number(row.rating),
    completedBookings: row.completed_bookings,
    premium: row.premium,
    featuredPriority: row.featured ? row.featured_priority : 0,
    distanceKm: row.distance_km != null ? Number(row.distance_km) : null,
    radiusKm,
  });
  return { ...row, badges, rankScore };
};

export const listBusinesses = async (query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;

  const { rows, total } = await searchService.searchBusinesses({
    search: query.search,
    categoryId: query.categoryId,
    city: query.city,
    lat: query.lat,
    lng: query.lng,
    radiusKm: query.lat != null ? query.radiusKm || DEFAULT_SEARCH_RADIUS_KM : undefined,
    sortBy: query.sortBy,
    openNow: query.openNow,
    openToday: query.openToday,
    minRating: query.minRating,
    priceMin: query.priceMin,
    priceMax: query.priceMax,
    serviceCategoryId: query.serviceCategoryId,
    amenities: query.amenities,
    paymentMethods: query.paymentMethods,
    languages: query.languages,
    accessibility: query.accessibility,
    verifiedOnly: query.verifiedOnly,
    premiumOnly: query.premiumOnly,
    featuredOnly: query.featuredOnly,
    hasOffers: query.hasOffers,
    page,
    limit,
  });

  const radiusKm = query.lat != null ? query.radiusKm || DEFAULT_SEARCH_RADIUS_KM : undefined;
  const offerSummaries = await offerSummariesForStudioIds(rows.map((r) => r.id));
  return {
    businesses: rows.map((row) => ({ ...decorateBusinessCard(row, radiusKm), offer: offerSummaries.get(row.id) ?? null })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

/**
 * Phase 2.4 - the offer badge summary for a page of business cards, in ONE
 * query for the whole page (the N+1 trap this exists to avoid). Returns
 * Map<studioId, summary|null>. Reuses offer.engine.summarizeOffers so the card
 * badge and the detail page describe an offer the same way.
 */
const offerSummariesForStudioIds = async (studioIds) => {
  const map = new Map();
  if (studioIds.length === 0) return map;
  const offersByStudio = await offerRepo.liveOffersByStudioIds(studioIds);
  for (const [studioId, offers] of offersByStudio) {
    map.set(studioId, summarizeOffers(offers));
  }
  return map;
};

export const listForMap = (query) =>
  discoveryRepo.listForMap({
    lat: query.lat,
    lng: query.lng,
    radiusKm: query.radiusKm || DEFAULT_MAP_RADIUS_KM,
    minLat: query.minLat,
    maxLat: query.maxLat,
    minLng: query.minLng,
    maxLng: query.maxLng,
    limit: Number(query.limit) || 50,
  });

export const getBusiness = async (id) => {
  if (!isValidUUID(id)) throw new ServiceError(404, "Business not found");
  const business = await discoveryRepo.findBusinessPublic(id);
  if (!business) throw new ServiceError(404, "Business not found");

  const [services, professionals, workingHours, gallery, trust, recentBookings, premium, featured, liveOffers] = await Promise.all([
    serviceRepo.listForStudio(id, { activeOnly: true }),
    discoveryRepo.listProfessionalsForBusiness(id),
    discoveryRepo.findBusinessWorkingHours(id),
    galleryRepo.list(id),
    trustService.getTrustSignals(id),
    discoveryRepo.recentBookingCount(id),
    discoveryRepo.hasActivePremium(id),
    discoveryRepo.isCurrentlyFeatured(id),
    offerRepo.listCurrentlyLiveForStudio(id),
  ]);

  // Phase 2.4 - customer-facing live offers for the detail page's offer section.
  const offerServiceMap = await offerRepo.serviceIdsByOffer(liveOffers.map((o) => o.id));
  const offers = liveOffers.map((o) => toPublicOffer(o, offerServiceMap.get(o.id) ?? []));

  const badges = badgeService.computeBusinessBadges({
    verified: trust.verified,
    premium,
    featured,
    rating: Number(business.rating),
    reviewCount: business.review_count,
    completedBookings: trust.completed_bookings,
    businessAgeDays: trust.business_age_days,
    recentBookings,
  });

  // Professionals carry the "Verified Professional" badge from their business's
  // verification, plus their own experience/rating tiers.
  const professionalsWithBadges = professionals.map((p) => ({
    ...p,
    badges: badgeService.computeProfessionalBadges({
      businessVerified: trust.verified,
      rating: Number(p.rating),
      experienceYears: p.experience_years,
    }),
  }));

  return { ...business, badges, services, professionals: professionalsWithBadges, workingHours, gallery, trust, offers };
};

export const getBusinessServices = async (id) => {
  if (!isValidUUID(id)) throw new ServiceError(404, "Business not found");
  const business = await discoveryRepo.findBusinessPublic(id);
  if (!business) throw new ServiceError(404, "Business not found");
  return serviceRepo.listForStudio(id, { activeOnly: true });
};

export const getBusinessProfessionals = async (id) => {
  if (!isValidUUID(id)) throw new ServiceError(404, "Business not found");
  const business = await discoveryRepo.findBusinessPublic(id);
  if (!business) throw new ServiceError(404, "Business not found");
  return discoveryRepo.listProfessionalsForBusiness(id);
};

export const getProfessional = async (memberId) => {
  if (!isValidUUID(memberId)) throw new ServiceError(404, "Professional not found");
  const professional = await discoveryRepo.findProfessionalPublic(memberId);
  if (!professional) throw new ServiceError(404, "Professional not found");

  const [portfolio, certificates, businessVerified] = await Promise.all([
    portfolioRepo.list(memberId),
    certificateRepo.list(memberId),
    trustService.isBusinessVerified(professional.business_id),
  ]);

  const badges = badgeService.computeProfessionalBadges({
    businessVerified,
    rating: Number(professional.rating),
    experienceYears: professional.experience_years,
  });

  return { ...professional, badges, portfolio, certificates };
};
