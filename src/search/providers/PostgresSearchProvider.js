import { SearchProvider } from "../SearchProvider.js";
import * as discoveryRepo from "../../repositories/discovery.repository.js";

/**
 * Default search backend - delegates straight to discovery.repository.js's
 * existing ILIKE/Haversine query (report.md Phase 2.4), unchanged. This is
 * deliberately a thin wrapper, not a rewrite: that query is live, correct,
 * and the only thing that changes here is *who calls it* - future callers
 * go through SearchProvider/SearchService instead of importing the
 * repository directly, so a later swap to Meilisearch/Elasticsearch doesn't
 * ripple through every caller.
 */
export class PostgresSearchProvider extends SearchProvider {
  async searchBusinesses(params) {
    return discoveryRepo.listBusinesses(params);
  }
}
