import * as categoryRepo from "../repositories/category.repository.js";
import { cacheProvider } from "../cache/index.js";

const CATEGORIES_CACHE_TTL_SECONDS = 5 * 60;

// First real caller of CacheProvider (report.md Phase 0.4 plan) - hit on
// every discovery page load, changes rarely (admin-managed), so a short TTL
// cuts a full-table query down to near-zero without ever serving stale data
// for more than 5 minutes.
export const listCategories = (type) =>
  cacheProvider.getOrSet(`categories:${type || "all"}`, CATEGORIES_CACHE_TTL_SECONDS, () => categoryRepo.list(type));
