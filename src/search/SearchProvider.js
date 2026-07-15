/**
 * Contract every search backend must implement. SearchService and callers
 * depend only on this shape, never on a concrete backend or a raw query -
 * swapping Postgres full-text/ILIKE search for Meilisearch or Elasticsearch
 * later means writing one new class here and pointing search/index.js at
 * it, with no change to discovery.service.js or any controller.
 *
 * One method per searchable entity (mirrors media.service.js's MEDIA_FOLDERS
 * approach to extensibility) rather than a single fake-generic `search()` -
 * businesses/professionals/services are different queries against different
 * tables, and pretending otherwise here would just move that complexity
 * into a leakier abstraction. Only businesses exists today; adding
 * searchProfessionals()/searchServices() later is an additive method, not a
 * redesign.
 */
export class SearchProvider {
  /**
   * @param {{ search?: string, categoryId?: string, city?: string, lat?: number, lng?: number, radiusKm?: number, sortBy?: string, openNow?: boolean, page: number, limit: number }} _params
   * @returns {Promise<{ rows: object[], total: number }>}
   */
  async searchBusinesses(_params) {
    throw new Error(`${this.constructor.name} must implement searchBusinesses()`);
  }
}
