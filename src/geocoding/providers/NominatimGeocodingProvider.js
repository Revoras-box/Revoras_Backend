import { GeocodingProvider } from "../GeocodingProvider.js";

/**
 * Nominatim (OpenStreetMap) geocoding.
 *
 * Chosen for Phase 4A because its ODbL licence is the only one of the
 * mainstream options that permits *permanently storing* the coordinates it
 * returns, which is exactly what businesses.lat/lng does. Google forbids
 * caching results beyond 30 days; Mapbox reserves permanent storage for its
 * paid endpoint. See GeocodingProvider's header for the full comparison.
 *
 * In exchange, the public instance imposes obligations we have to honour in
 * code, not just in a README:
 *
 *   1. One request per second, absolute maximum. Enforced by `schedule()`
 *      below - a serialized queue, not a token bucket, because bursting is
 *      precisely what the policy forbids.
 *   2. A genuine User-Agent identifying the application and a contact route.
 *      Requests without one get blocked.
 *   3. Attribution displayed wherever results are shown (see attribution()).
 *
 * The 1 req/sec ceiling is affordable here only because geocoding is
 * onboarding-shaped traffic: once per business at signup, plus the occasional
 * pin correction. It would NOT survive being called from customer-facing
 * search. If geocoding ever moves onto a hot path, that's the signal to swap
 * this class out - not to raise the rate limit.
 */

const BASE_URL = "https://nominatim.openstreetmap.org";

// Nominatim blocks unidentified traffic, and a generic agent string is
// treated as unidentified. Overridable so a deployment can point the contact
// address at whoever actually operates that environment.
const USER_AGENT =
  process.env.GEOCODING_USER_AGENT || "Revoras/1.0 (marketplace business onboarding; contact: support@uvingroup.xyz)";

// Bias results toward the market we operate in. Nominatim happily returns a
// "Luxe Hair Studio" in Ohio for an Indian address query otherwise, and an
// owner skimming a picker list will click it.
const DEFAULT_COUNTRY_CODES = (process.env.GEOCODING_COUNTRY_CODES || "in").split(",");

const MIN_REQUEST_INTERVAL_MS = 1000;
const REQUEST_TIMEOUT_MS = 8000;

// The public instance sits behind a Varnish tier that intermittently answers
// "503 No healthy backends" and occasionally just stalls, even for traffic
// well inside the usage policy - observed repeatedly while building this.
// A single transient blip shouldn't surface to an owner mid-onboarding as
// "we couldn't find your address", so retry the failures that are plausibly
// transient. 4xx is never retried: a 403 means our User-Agent is blocked and
// a 429 means we've already broken the rate limit, and hammering either one
// makes things worse.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 600;

export class NominatimGeocodingProvider extends GeocodingProvider {
  #queue = Promise.resolve();
  #lastRequestAt = 0;

  /**
   * Serializes every outbound call and spaces them at least a second apart.
   *
   * Chaining onto a single promise (rather than checking elapsed time per
   * call) is what makes this correct under concurrency: two simultaneous
   * requests can't both observe an old `#lastRequestAt` and fire together.
   * The cost is that the second caller waits - acceptable, because the
   * alternative is getting the whole deployment blocked.
   */
  #schedule(task) {
    const run = this.#queue.then(async () => {
      const waitMs = MIN_REQUEST_INTERVAL_MS - (Date.now() - this.#lastRequestAt);
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      this.#lastRequestAt = Date.now();
      return task();
    });

    // Keep the chain alive after a rejection, otherwise one failed lookup
    // poisons every subsequent request on this provider instance.
    this.#queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async #request(path, params) {
    const url = new URL(`${BASE_URL}${path}`);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    for (const [key, value] of Object.entries(params)) {
      if (value != null) url.searchParams.set(key, String(value));
    }

    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // Each attempt goes through #schedule independently, so retries are
        // rate-limited exactly like first tries - a retry storm can't bypass
        // the 1 req/sec policy.
        return await this.#schedule(async () => {
          // Nominatim can hang; without a timeout an onboarding request would
          // sit open until the client gives up.
          const res = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, "Accept-Language": "en" },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });

          if (!res.ok) {
            const err = new Error(`Nominatim responded ${res.status}`);
            err.retryable = res.status >= 500;
            throw err;
          }
          return res.json();
        });
      } catch (err) {
        lastError = err;
        // Network-level failures (timeouts, DNS, socket resets) arrive as
        // plain errors with no status, and are as transient as a 503.
        const retryable = err.retryable ?? true;
        if (!retryable || attempt === MAX_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_DELAY_MS * attempt));
      }
    }
    throw lastError;
  }

  /**
   * Nominatim's address object is a loose bag of keys that vary by place type
   * - a city can arrive as `city`, `town`, `village` or `municipality`
   * depending on how it's tagged in OSM. Collapsing those onto our column
   * names here keeps that quirk from leaking into the wizard.
   */
  #toResult(raw) {
    if (!raw?.lat || !raw?.lon) return null;
    const a = raw.address || {};
    return {
      lat: Number(raw.lat),
      lng: Number(raw.lon),
      displayName: raw.display_name || "",
      address: {
        line1: [a.house_number, a.road].filter(Boolean).join(" ") || undefined,
        city: a.city || a.town || a.village || a.municipality || a.county || undefined,
        state: a.state || undefined,
        country: a.country || undefined,
        zipCode: a.postcode || undefined,
      },
    };
  }

  async forwardGeocode(query, { limit = 5, countryCodes = DEFAULT_COUNTRY_CODES } = {}) {
    const trimmed = (query || "").trim();
    if (!trimmed) return [];

    const raw = await this.#request("/search", {
      q: trimmed,
      limit,
      countrycodes: countryCodes?.length ? countryCodes.join(",") : undefined,
    });

    return (Array.isArray(raw) ? raw : []).map((r) => this.#toResult(r)).filter(Boolean);
  }

  async reverseGeocode(lat, lng) {
    const raw = await this.#request("/reverse", { lat, lon: lng });
    // Reverse lookups over unmapped areas return an { error } object with a
    // 200 status, so a falsy result here is expected, not exceptional.
    return this.#toResult(raw);
  }

  attribution() {
    return "© OpenStreetMap contributors";
  }
}
