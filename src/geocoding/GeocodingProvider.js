/**
 * Contract every geocoding backend must implement. GeocodingService and
 * callers depend only on this shape, never on a concrete provider - moving
 * from Nominatim to Mapbox's permanent-geocoding endpoint (or Google, or a
 * self-hosted Nominatim) later means writing one new class here and pointing
 * geocoding/index.js at it, with no change to the service, controller or the
 * business dashboard's location editor.
 *
 * That swap is a question of *when*, not *if*: provider choice here is a
 * licensing decision as much as a quality one. Phase 4A stores coordinates
 * permanently in businesses.lat/lng, which Google's terms forbid beyond 30
 * days and Mapbox allows only on its paid permanent endpoint. Nominatim's
 * ODbL permits it outright, which is why it's the first implementation - see
 * NominatimGeocodingProvider for the obligations that come with it.
 *
 * Two methods rather than one generic `geocode()`: forward (text -> coords)
 * and reverse (coords -> text) are different endpoints with different inputs
 * on every provider, and collapsing them would just move that branch into a
 * leakier abstraction.
 */

/**
 * @typedef {object} GeocodeResult
 * @property {number} lat
 * @property {number} lng
 * @property {string} displayName  Full human-readable address, for the picker list.
 * @property {{ line1?: string, city?: string, state?: string, country?: string, zipCode?: string }} address
 *   Structured components, mapped onto the column names businesses already
 *   uses (city/state/country/zip_code) so callers never translate field names.
 */

export class GeocodingProvider {
  /**
   * Text query -> ranked candidate locations. Returns [] rather than throwing
   * when nothing matches; "no results" is a normal outcome of a search box,
   * not an error condition.
   * @param {string} _query
   * @param {{ limit?: number, countryCodes?: string[] }} [_options]
   * @returns {Promise<GeocodeResult[]>}
   */
  async forwardGeocode(_query, _options) {
    throw new Error(`${this.constructor.name} must implement forwardGeocode()`);
  }

  /**
   * Coordinates -> nearest address. Used when the owner drags the pin, so the
   * address fields follow the marker instead of going stale.
   * @param {number} _lat
   * @param {number} _lng
   * @returns {Promise<GeocodeResult|null>} null when the point has no known address (open water, unmapped area)
   */
  async reverseGeocode(_lat, _lng) {
    throw new Error(`${this.constructor.name} must implement reverseGeocode()`);
  }

  /**
   * Attribution string the UI must display alongside geocoded results.
   * Lives on the provider because it changes with the provider - ODbL credit
   * for Nominatim, a different notice for Mapbox - and forgetting to update
   * it during a swap would be a licensing violation, not a cosmetic bug.
   * @returns {string}
   */
  attribution() {
    throw new Error(`${this.constructor.name} must implement attribution()`);
  }
}
