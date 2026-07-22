import { geocodingProvider } from "../geocoding/index.js";
import { cacheProvider } from "../cache/index.js";
import { ServiceError } from "../utils/ServiceError.js";
import { logger } from "../utils/logger.js";

/**
 * Phase 4A. Sits between the controller and whichever GeocodingProvider is
 * active, and exists mainly to keep our third-party budget under control.
 *
 * Geocoding is proxied through the backend rather than called from the
 * browser for three reasons, all of which would break if the wizard hit
 * Nominatim directly:
 *   - the required User-Agent can't be set on a browser fetch at all;
 *   - the 1 req/sec policy is a *deployment-wide* budget, and only the server
 *     can see total traffic well enough to honour it;
 *   - a paid provider's key (the likely successor here) can't ship to a client.
 *
 * Caching matters more than usual for the same reason. The provider
 * serializes every call at one per second, so without a cache a handful of
 * concurrent owners typing addresses would queue behind each other. Address
 * lookups are also extremely repetitive - the same few dozen neighbourhood
 * names in a city - so the hit rate is high and the underlying data barely
 * changes week to week.
 */

// Long by the standards of the rest of the app: OSM address data changes on a
// timescale of months, and a stale street name is a far smaller problem than
// exhausting the request budget.
const FORWARD_TTL_SECONDS = 7 * 24 * 60 * 60;
const REVERSE_TTL_SECONDS = 7 * 24 * 60 * 60;

// Reverse lookups come from a dragged marker, which emits a new coordinate on
// every pointer move. Rounding to ~11m before caching turns that stream into
// a handful of distinct keys instead of hundreds of cache misses; it's well
// under the precision anyone can meaningfully place a shopfront pin at.
const REVERSE_PRECISION = 4;

/**
 * Turns a provider outage into an honest, actionable 503 instead of letting a
 * raw fetch error bubble up as "Internal server error".
 *
 * This distinction is not cosmetic. The public Nominatim instance answers
 * "503 No healthy backends" intermittently even for well-behaved traffic
 * (seen repeatedly during Phase 4A development, which is why the provider
 * retries at all). Those blips WILL reach owners. A 500 tells them something
 * is broken on our side and gives the UI nothing to branch on; a 503 with
 * this message lets the Location step degrade to manual pin placement and
 * keep onboarding moving.
 *
 * Keeping the funnel alive when a third party is down is a lesson this
 * codebase has already paid for once - an expired R2 credential made Gallery
 * unsatisfiable and silently blocked every new business from going live.
 * Geocoding must never become a second instance of that.
 */
const withProviderFallback = async (operation, context, fn) => {
  try {
    return await fn();
  } catch (err) {
    logger.error("Geocoding provider failed", { operation, context, message: err.message });
    throw new ServiceError(
      503,
      "Address lookup is temporarily unavailable. You can still set your location by placing the pin on the map.",
    );
  }
};

export const forwardGeocode = async ({ q, limit }) => {
  const key = `geocode:fwd:${q.toLowerCase()}:${limit ?? "default"}`;
  const results = await withProviderFallback("forwardGeocode", { q }, () =>
    cacheProvider.getOrSet(key, FORWARD_TTL_SECONDS, () => geocodingProvider.forwardGeocode(q, { limit })),
  );
  return { results, attribution: geocodingProvider.attribution() };
};

export const reverseGeocode = async ({ lat, lng }) => {
  const roundedLat = Number(lat.toFixed(REVERSE_PRECISION));
  const roundedLng = Number(lng.toFixed(REVERSE_PRECISION));
  const key = `geocode:rev:${roundedLat},${roundedLng}`;
  const result = await withProviderFallback("reverseGeocode", { lat: roundedLat, lng: roundedLng }, () =>
    cacheProvider.getOrSet(key, REVERSE_TTL_SECONDS, () => geocodingProvider.reverseGeocode(roundedLat, roundedLng)),
  );
  return { result, attribution: geocodingProvider.attribution() };
};
