import knex from "../../db/knex.js";
import { RANK_WEIGHTS, POPULARITY_SATURATION, DISTANCE_FALLOFF_KM, FEATURED_BOOST_MAX } from "../services/ranking.service.js";

// Phase 1.4c: window for the "trending" signal - bookings taken in the last N
// days (see badge.service.computeBusinessBadges).
const RECENT_BOOKINGS_WINDOW_DAYS = 14;

// Phase 2 (Discovery Experience): "Open Now" is a hard correctness filter, not
// a ranking preference - a closed business shouldn't appear no matter how it's
// sorted. Mirrors booking.repository.js's existing convention of comparing
// against the DB's own CURRENT_DATE/CURRENT_TIME directly (no per-business
// timezone column exists; the whole product is single-timezone/India-only).
const OPEN_NOW_SQL = `exists (
  select 1 from working_hours wh
  where wh.studio_id = biz.id
    and wh.day_of_week = extract(dow from current_date)::int
    and wh.is_closed = false
    and wh.open_time is not null and wh.close_time is not null
    and current_time >= wh.open_time and current_time < wh.close_time
)`;

// "Open Today" - same day, no time-of-day check (weaker than Open Now).
const OPEN_TODAY_SQL = `exists (
  select 1 from working_hours wh
  where wh.studio_id = biz.id
    and wh.day_of_week = extract(dow from current_date)::int
    and wh.is_closed = false
)`;

/**
 * Phase 2.1 (Advanced Filters). These are deliberately self-contained EXISTS/
 * column-comparison fragments (not references to the query's own LEFT JOIN
 * aliases like `ts`/`sub`) so the exact same WHERE clause can be added to both
 * `query` and `countQuery` below without duplicating a matching join on each -
 * one wrong join easily desyncs a paginated list's total from what's on the
 * page, which is worse than the small redundancy of a second EXISTS.
 */
const VERIFIED_EXISTS_SQL = `exists (select 1 from trust_scores ts2 where ts2.business_id = biz.id and ts2.verified = true)`;
// Same "currently active" definition as activePremiumSubquery / businessSubscription.service.js's isCurrentlyActive.
const PREMIUM_EXISTS_SQL = `exists (select 1 from business_subscriptions bs2 where bs2.business_id = biz.id and bs2.status = 'active' and bs2.current_period_end > now())`;
// Phase 2.2 (Discovery Curation System) - "currently featured": the flag is
// set, we're inside its optional start/end window, and (if regionally
// targeted) the business's own city or state matches. Plain column
// comparisons against `biz.*` only, so - like the EXISTS fragments above -
// it's safe to reuse verbatim in both `query` and `countQuery`.
const FEATURED_EFFECTIVE_SQL = `(
  biz.is_featured = true
  and (biz.featured_start_at is null or biz.featured_start_at <= now())
  and (biz.featured_end_at is null or biz.featured_end_at > now())
  and (biz.featured_region is null or biz.featured_region ilike biz.city or biz.featured_region ilike biz.state)
)`;
// Phase 2.4 (Offers & Promotions) - "has a currently-live offer": active and
// inside its optional start/end window. Matches
// offer.repository.js listCurrentlyLiveForStudio / studioIdsWithLiveOffers, so
// the discovery filter and the badge agree on what "live" means. Plain
// subquery against biz.id, safe in both query and countQuery.
const HAS_LIVE_OFFER_SQL = `exists (
  select 1 from offers of2
  where of2.studio_id = biz.id
    and of2.is_active = true
    and (of2.start_at is null or of2.start_at <= now())
    and (of2.end_at is null or of2.end_at >= now())
)`;
const serviceCategoryExistsSql = () =>
  `exists (select 1 from services sv where sv.studio_id = biz.id and sv.is_active = true and sv.category_id = ?)`;
// Price range is "has at least one active service in [min,max]", not a range
// overlap of the business's full price spectrum - more intuitive for a
// customer filtering by budget ("show me businesses I can afford"), and
// avoids needing a LEFT JOIN aggregate just to filter (the aggregate below,
// servicePriceSubquery, exists only for the priceLow/priceHigh *sort*).
const priceRangeExistsSql = ({ priceMin, priceMax }) => {
  const conditions = ["sv.studio_id = biz.id", "sv.is_active = true"];
  const bindings = [];
  if (priceMin != null) {
    conditions.push("sv.price >= ?");
    bindings.push(priceMin);
  }
  if (priceMax != null) {
    conditions.push("sv.price <= ?");
    bindings.push(priceMax);
  }
  return { sql: `exists (select 1 from services sv where ${conditions.join(" and ")})`, bindings };
};
// "ANY of the requested tags" against a jsonb array column (amenities/
// payment_methods/languages) - built as OR'd single-element @> containment
// checks rather than the jsonb `?|` operator, because `?` collides with
// knex's own bind-placeholder syntax in raw SQL.
const anyOfJsonArraySql = (column, csvValue) => {
  const tags = (csvValue || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  if (tags.length === 0) return null;
  return {
    sql: `(${tags.map(() => `${column} @> ?::jsonb`).join(" or ")})`,
    bindings: tags.map((t) => JSON.stringify([t])),
  };
};

/**
 * Public customer-facing browsing over the Business/Professional/Category
 * model (report.md §2.0/§3.2) - replaces studio.controller.js's queries
 * against the dropped `studios`/`barbers` tables. Only ever returns
 * approved + active businesses; a pending/suspended business is invisible
 * here regardless of what its owner can see via /api/business/:studioId.
 */

const BUSINESS_CARD_FIELDS = [
  "biz.id",
  "biz.name",
  "biz.slug",
  "biz.address",
  "biz.city",
  "biz.state",
  "biz.lat",
  "biz.lng",
  "biz.rating",
  "biz.review_count",
  "biz.amenities",
  "c.name as category_name",
  "c.slug as category_slug",
];

// The card image falls back to the business's uploaded gallery when the
// business row itself has no dedicated image_url/cover set. A business that
// has uploaded gallery photos (business_gallery_images) should never render
// as a blank monogram tile on Discover. Preference: an explicitly-set
// image_url, else the gallery's cover image, else its first photo by
// sort_order (oldest as final tie-break). Correlated subquery so it composes
// with all the existing filters/sorts without another LEFT JOIN.
const CARD_IMAGE_SQL = `coalesce(biz.image_url, (
  select gi.url from business_gallery_images gi
  where gi.studio_id = biz.id
  order by gi.is_cover desc, gi.sort_order asc, gi.created_at asc
  limit 1
))`;

// Plain SQL fragment (3 positional `?` placeholders: lat, lng, lat) rather
// than a pre-built knex.raw() object - reusing a Raw instance's internal
// .sql/.bindings across a second raw() call is fragile/undocumented Knex
// behavior. Each call site below supplies its own [lat, lng, lat, ...]
// bindings array explicitly instead.
const HAVERSINE_KM_SQL = `6371 * acos(least(1, greatest(-1,
  cos(radians(?)) * cos(radians(biz.lat)) * cos(radians(biz.lng) - radians(?)) + sin(radians(?)) * sin(radians(biz.lat))
)))`;

// Phase 1.4c: the location-independent ranking inputs live on `trust_scores`
// (a LEFT JOIN so a business with no computed trust row still lists, just with
// score 0). `recentBookings` (trending) comes from a small grouped subquery.
// The recommended-sort ORDER BY is built from ranking.service's RANK_WEIGHTS so
// the SQL and the pure computeRankScore can't drift.
const recentBookingsSubquery = (db) =>
  db("bookings")
    .select("studio_id")
    .count("* as recent_bookings")
    .whereRaw(`created_at > now() - interval '${RECENT_BOOKINGS_WINDOW_DAYS} days'`)
    .whereIn("status", ["confirmed", "completed"])
    .groupBy("studio_id")
    .as("rb");

// Phase 1.5d landed real subscriptions; this join resolves "premium" (used by
// both ranking.service's W.premium boost and badge.service's "Premium" badge)
// to whether the business currently has an ACTIVE, non-lapsed subscription -
// same definition as businessSubscription.service.js's isCurrentlyActive.
// groupBy dedupes so a business's subscription history never multiplies rows
// in the outer join (pagination/COUNT would otherwise be wrong).
const activePremiumSubquery = (db) =>
  db("business_subscriptions")
    .select("business_id")
    .where({ status: "active" })
    .andWhere("current_period_end", ">", db.fn.now())
    .groupBy("business_id")
    .as("sub");

// Phase 2.1 (Advanced Filters) - per-business min/max ACTIVE service price, for
// the priceLow/priceHigh sort only (the priceMin/priceMax *filter* uses
// priceRangeExistsSql instead, which doesn't need a join - see its comment).
const servicePriceSubquery = (db) =>
  db("services")
    .select("studio_id")
    .min("price as min_price")
    .max("price as max_price")
    .where({ is_active: true })
    .groupBy("studio_id")
    .as("sp");

// Returns { sql, bindings } for the weighted composite (0-100) plus the
// separate Phase 2.2 featured boost (see ranking.service.js's module
// docblock for why that boost is additive-on-top rather than a 6th
// RANK_WEIGHTS term). Distance only contributes when the searcher supplied a
// location. `sub` (the premium join) is always present in the outer query,
// so it's always safe to reference here.
const rankExpression = ({ lat, lng, radiusKm }) => {
  const W = RANK_WEIGHTS;
  let sql =
    `(coalesce(ts.score,0)/100.0)*${W.trust}` +
    ` + (biz.rating/5.0)*${W.rating}` +
    ` + least(coalesce(ts.completed_bookings,0)/${POPULARITY_SATURATION}.0, 1)*${W.popularity}` +
    ` + (case when sub.business_id is not null then ${W.premium} else 0 end)` +
    ` + (case when ${FEATURED_EFFECTIVE_SQL} then least(biz.featured_priority, ${FEATURED_BOOST_MAX}) else 0 end)`;
  const bindings = [];
  if (lat != null && lng != null) {
    const falloff = radiusKm || DISTANCE_FALLOFF_KM;
    sql += ` + greatest(0, 1 - (${HAVERSINE_KM_SQL})/${falloff}) * ${W.distance}`;
    bindings.push(lat, lng, lat);
  }
  return { sql, bindings };
};

export const listBusinesses = async (
  {
    search,
    categoryId,
    city,
    lat,
    lng,
    radiusKm,
    sortBy,
    openNow,
    openToday,
    minRating,
    priceMin,
    priceMax,
    serviceCategoryId,
    amenities,
    paymentMethods,
    languages,
    accessibility,
    verifiedOnly,
    premiumOnly,
    featuredOnly,
    hasOffers,
    businessIds,
    excludeIds,
    page,
    limit,
  },
  db = knex
) => {
  let query = db("businesses as biz")
    .leftJoin("categories as c", "biz.category_id", "c.id")
    .leftJoin("trust_scores as ts", "ts.business_id", "biz.id")
    .leftJoin(recentBookingsSubquery(db), "rb.studio_id", "biz.id")
    .leftJoin(activePremiumSubquery(db), "sub.business_id", "biz.id")
    .leftJoin(servicePriceSubquery(db), "sp.studio_id", "biz.id")
    .where({ "biz.business_status": "active" });
  // Aliased "as biz" (not the bare table) so it can share OPEN_NOW_SQL/count
  // logic with the main query below without a second SQL string to keep in sync.
  let countQuery = db("businesses as biz").where({ "biz.business_status": "active" });

  if (search) {
    query = query.andWhere((qb) => qb.whereILike("biz.name", `%${search}%`).orWhereILike("biz.address", `%${search}%`));
    countQuery = countQuery.andWhere((qb) => qb.whereILike("biz.name", `%${search}%`).orWhereILike("biz.address", `%${search}%`));
  }
  if (categoryId) {
    query = query.andWhere({ "biz.category_id": categoryId });
    countQuery = countQuery.andWhere({ "biz.category_id": categoryId });
  }
  if (city) {
    query = query.andWhereILike("biz.city", city);
    countQuery = countQuery.andWhereILike("biz.city", city);
  }
  // Phase 2.2 (Discovery Curation System) - businessIds/excludeIds power
  // collection resolution (collection.service.js): businessIds fetches full
  // card data for manually pinned businesses; excludeIds pulls the
  // filter-matched auto-fill pool without duplicating a pinned business.
  if (businessIds && businessIds.length > 0) {
    query = query.whereIn("biz.id", businessIds);
    countQuery = countQuery.whereIn("biz.id", businessIds);
  }
  if (excludeIds && excludeIds.length > 0) {
    query = query.whereNotIn("biz.id", excludeIds);
    countQuery = countQuery.whereNotIn("biz.id", excludeIds);
  }
  if (lat != null && lng != null && radiusKm) {
    query = query.andWhereRaw(`${HAVERSINE_KM_SQL} <= ?`, [lat, lng, lat, radiusKm]);
  }
  if (openNow) {
    query = query.andWhereRaw(OPEN_NOW_SQL);
    countQuery = countQuery.andWhereRaw(OPEN_NOW_SQL);
  }
  if (openToday) {
    query = query.andWhereRaw(OPEN_TODAY_SQL);
    countQuery = countQuery.andWhereRaw(OPEN_TODAY_SQL);
  }
  if (minRating != null) {
    query = query.andWhere("biz.rating", ">=", minRating);
    countQuery = countQuery.andWhere("biz.rating", ">=", minRating);
  }
  if (priceMin != null || priceMax != null) {
    const { sql, bindings } = priceRangeExistsSql({ priceMin, priceMax });
    query = query.andWhereRaw(sql, bindings);
    countQuery = countQuery.andWhereRaw(sql, bindings);
  }
  if (serviceCategoryId) {
    query = query.andWhereRaw(serviceCategoryExistsSql(), [serviceCategoryId]);
    countQuery = countQuery.andWhereRaw(serviceCategoryExistsSql(), [serviceCategoryId]);
  }
  for (const [column, csvValue] of [
    ["biz.amenities", amenities],
    ["biz.payment_methods", paymentMethods],
    ["biz.languages", languages],
    ["biz.accessibility", accessibility],
  ]) {
    const clause = anyOfJsonArraySql(column, csvValue);
    if (clause) {
      query = query.andWhereRaw(clause.sql, clause.bindings);
      countQuery = countQuery.andWhereRaw(clause.sql, clause.bindings);
    }
  }
  if (verifiedOnly) {
    query = query.andWhereRaw(VERIFIED_EXISTS_SQL);
    countQuery = countQuery.andWhereRaw(VERIFIED_EXISTS_SQL);
  }
  if (premiumOnly) {
    query = query.andWhereRaw(PREMIUM_EXISTS_SQL);
    countQuery = countQuery.andWhereRaw(PREMIUM_EXISTS_SQL);
  }
  if (featuredOnly) {
    query = query.andWhereRaw(FEATURED_EFFECTIVE_SQL);
    countQuery = countQuery.andWhereRaw(FEATURED_EFFECTIVE_SQL);
  }
  if (hasOffers) {
    query = query.andWhereRaw(HAS_LIVE_OFFER_SQL);
    countQuery = countQuery.andWhereRaw(HAS_LIVE_OFFER_SQL);
  }

  const selectFields = [
    ...BUSINESS_CARD_FIELDS,
    db.raw(`${CARD_IMAGE_SQL} as image_url`),
    "biz.created_at",
    db.raw("coalesce(ts.score, 0) as trust_score"),
    db.raw("coalesce(ts.verified, false) as verified"),
    db.raw("coalesce(ts.completed_bookings, 0) as completed_bookings"),
    db.raw("coalesce(rb.recent_bookings, 0)::int as recent_bookings"),
    db.raw("(sub.business_id is not null) as premium"),
    db.raw(`${FEATURED_EFFECTIVE_SQL} as featured`),
    "biz.featured_priority",
    db.raw("sp.min_price as starting_price"),
    db.raw("ts.avg_response_minutes as avg_response_minutes"),
  ];
  if (lat != null && lng != null) {
    selectFields.push(db.raw(`${HAVERSINE_KM_SQL} as distance_km`, [lat, lng, lat]));
  }
  query = query.select(selectFields);

  if (sortBy === "distance" && lat != null && lng != null) {
    query = query.orderByRaw(`${HAVERSINE_KM_SQL} asc`, [lat, lng, lat]);
  } else if (sortBy === "reviews") {
    query = query.orderBy("biz.review_count", "desc");
  } else if (sortBy === "name") {
    query = query.orderBy("biz.name", "asc");
  } else if (sortBy === "rating") {
    query = query.orderBy("biz.rating", "desc");
  } else if (sortBy === "popular") {
    // "Popular" rail - completed-bookings volume, all-time (distinct from
    // "trending", which is a short recent window). Tie-break on rating.
    query = query.orderByRaw("coalesce(ts.completed_bookings, 0) desc, biz.rating desc");
  } else if (sortBy === "trending") {
    // "Trending" rail - recent-window booking momentum (same signal that
    // drives the "Trending" badge - see RECENT_BOOKINGS_WINDOW_DAYS above).
    query = query.orderByRaw("coalesce(rb.recent_bookings, 0) desc, biz.rating desc");
  } else if (sortBy === "newest") {
    query = query.orderBy("biz.created_at", "desc");
  } else if (sortBy === "priceLow") {
    // "Starting from ₹X" ascending. Default NULLS LAST for ASC already puts
    // businesses with no active services (no price data) at the bottom.
    query = query.orderByRaw("sp.min_price asc, biz.rating desc");
  } else if (sortBy === "priceHigh") {
    // Explicit NULLS LAST - Postgres's DESC default is NULLS FIRST, which
    // would otherwise put no-price-data businesses at the very top.
    query = query.orderByRaw("sp.max_price desc nulls last, biz.rating desc");
  } else if (sortBy === "fastestResponse") {
    query = query.orderByRaw("ts.avg_response_minutes asc nulls last, biz.rating desc");
  } else {
    // "recommended" (default) - the weighted composite. Tie-break on rating so
    // ordering is deterministic across pages.
    const { sql, bindings } = rankExpression({ lat, lng, radiusKm });
    query = query.orderByRaw(`(${sql}) desc, biz.rating desc`, bindings);
  }

  query = query.limit(limit).offset((page - 1) * limit);

  const [rows, [{ count }]] = await Promise.all([query, countQuery.count("* as count")]);
  return { rows, total: Number(count) };
};

export const listForMap = async ({ lat, lng, radiusKm, minLat, maxLat, minLng, maxLng, limit }, db = knex) => {
  let query = db("businesses as biz")
    .where({ "biz.business_status": "active" })
    .whereNotNull("biz.lat")
    .whereNotNull("biz.lng")
    .select("biz.id", "biz.name", "biz.lat", "biz.lng", "biz.address", "biz.city", "biz.rating", "biz.review_count", db.raw(`${CARD_IMAGE_SQL} as image_url`));

  if (minLat != null && maxLat != null && minLng != null && maxLng != null) {
    query = query.andWhereBetween("biz.lat", [minLat, maxLat]).andWhereBetween("biz.lng", [minLng, maxLng]);
  } else if (lat != null && lng != null) {
    query = query.andWhereRaw(`${HAVERSINE_KM_SQL} <= ?`, [lat, lng, lat, radiusKm]);
  }

  if (lat != null && lng != null) {
    query = query.select(db.raw(`${HAVERSINE_KM_SQL} as distance_km`, [lat, lng, lat])).orderBy("distance_km", "asc");
  } else {
    query = query.orderBy("biz.rating", "desc");
  }

  return query.limit(limit);
};

export const findBusinessPublic = (id, db = knex) =>
  db("businesses as biz")
    .leftJoin("categories as c", "biz.category_id", "c.id")
    .where({ "biz.id": id, "biz.business_status": "active" })
    .select(
      "biz.id",
      "biz.name",
      "biz.slug",
      "biz.description",
      "biz.address",
      "biz.city",
      "biz.state",
      "biz.zip_code",
      "biz.country",
      "biz.lat",
      "biz.lng",
      "biz.phone",
      "biz.email",
      "biz.image_url",
      "biz.logo_url",
      "biz.banner_url",
      "biz.amenities",
      "biz.website",
      "biz.social_links",
      "biz.languages",
      "biz.payment_methods",
      "biz.policies",
      "biz.accessibility",
      "biz.house_rules",
      "biz.rating",
      "biz.review_count",
      "c.name as category_name",
      "c.slug as category_slug"
    )
    .first();

export const listProfessionalsForBusiness = (studioId, db = knex) =>
  db("business_members as bm")
    .join("users as u", "bm.user_id", "u.id")
    .where({ "bm.studio_id": studioId, "bm.status": "active", "bm.provides_services": true })
    .select(
      "bm.id",
      "bm.designation",
      "bm.specialties",
      "bm.experience_years",
      "bm.rating",
      "bm.image_url",
      "u.name"
    )
    .orderBy("bm.rating", "desc");

export const findProfessionalPublic = (memberId, db = knex) =>
  db("business_members as bm")
    .join("users as u", "bm.user_id", "u.id")
    .join("businesses as biz", "bm.studio_id", "biz.id")
    .where({ "bm.id": memberId, "bm.status": "active", "biz.business_status": "active" })
    .select(
      "bm.id",
      "bm.studio_id",
      "bm.designation",
      "bm.specialties",
      "bm.experience_years",
      "bm.rating",
      "bm.image_url",
      "bm.provides_services",
      "bm.bio",
      "bm.languages",
      "bm.education",
      "bm.awards",
      "bm.social_links",
      "bm.featured_service_ids",
      "u.name",
      "biz.name as business_name",
      "biz.id as business_id"
    )
    .first();

export const findBusinessWorkingHours = (studioId, db = knex) =>
  db("working_hours").where({ studio_id: studioId }).orderBy("day_of_week");

// Phase 1.4c: recent booking volume for the trending badge on the detail page
// (the list query computes this inline via recentBookingsSubquery).
export const recentBookingCount = (studioId, db = knex) =>
  db("bookings")
    .where({ studio_id: studioId })
    .whereRaw(`created_at > now() - interval '${RECENT_BOOKINGS_WINDOW_DAYS} days'`)
    .whereIn("status", ["confirmed", "completed"])
    .count("* as c")
    .first()
    .then((r) => Number(r.c));

// Phase 2 (Discovery Experience): "premium" for the detail page (the list
// query computes this inline via activePremiumSubquery). Same definition as
// businessSubscription.service.js's isCurrentlyActive.
export const hasActivePremium = (studioId, db = knex) =>
  db("business_subscriptions")
    .where({ business_id: studioId, status: "active" })
    .andWhere("current_period_end", ">", db.fn.now())
    .first()
    .then((row) => !!row);

// Phase 2.2 (Discovery Curation System) - "featured" for the detail page (the
// list query computes this inline via FEATURED_EFFECTIVE_SQL). Same
// definition, just evaluated for one row instead of in the outer WHERE.
export const isCurrentlyFeatured = (studioId, db = knex) =>
  db("businesses as biz")
    .where({ "biz.id": studioId })
    .whereRaw(FEATURED_EFFECTIVE_SQL)
    .first("biz.id")
    .then((row) => !!row);
