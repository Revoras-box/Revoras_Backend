import { PostgresSearchProvider } from "./providers/PostgresSearchProvider.js";

/**
 * The single place that picks the active search backend. Everything else
 * (SearchService, and transitively discovery.service.js) imports
 * `searchProvider` from here and only ever calls methods defined on
 * SearchProvider - switching to Meilisearch or Elasticsearch later means
 * writing one new *SearchProvider class and changing the line below.
 */
export const searchProvider = new PostgresSearchProvider();
