import { searchProvider } from "../search/index.js";

/**
 * The one path any feature (Discovery homepage, collections, future
 * professional/service search) should use to reach search - controllers and
 * services must never call discovery.repository.js or a search backend
 * directly. Thin today (report.md Phase 0.3 plan is "wrap, don't rewrite");
 * this is the seam where ranking/ synonyms/query-normalization get added
 * later without touching every caller.
 */
export const searchBusinesses = (params) => searchProvider.searchBusinesses(params);
