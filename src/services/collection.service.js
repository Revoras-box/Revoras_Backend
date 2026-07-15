import * as collectionRepo from "../repositories/collection.repository.js";
import * as discoveryRepo from "../repositories/discovery.repository.js";
import { decorateBusinessCard } from "./discovery.service.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Phase 2.2 (Discovery Curation System) - Collections. The one genuinely new
 * idea here is `resolve()`: everything else is CRUD over `collections`/
 * `collection_items`. Resolution deliberately reuses
 * discovery.repository.js's listBusinesses (the brief: "Reuse the existing
 * Search/Discovery layer rather than creating new SQL") for both the pinned
 * businesses' card data AND the filter-matched auto-fill pool, and reuses
 * discovery.service.js's decorateBusinessCard for badges/rankScore - a
 * resolved collection business looks and ranks exactly like a normal
 * discovery result, because it's produced by the same code.
 *
 * Pagination is intentionally simple: pull up to AUTO_FILL_POOL_SIZE
 * auto-matched businesses in one query, merge with pinned, paginate the
 * combined array in memory. Correct up to that bound, which comfortably
 * covers an editorial list's realistic size; a collection genuinely needing
 * more than that is a scale case beyond what this feature is for.
 */

const AUTO_FILL_POOL_SIZE = 200;

const slugify = (title) =>
  title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const serializeCollection = (row) => ({
  id: row.id,
  title: row.title,
  subtitle: row.subtitle,
  slug: row.slug,
  coverImageUrl: row.cover_image_url,
  description: row.description,
  displayOrder: row.display_order,
  isActive: row.is_active,
  startAt: row.start_at,
  endAt: row.end_at,
  targetCity: row.target_city,
  targetState: row.target_state,
  filterCategoryId: row.filter_category_id,
  filterMinRating: row.filter_min_rating != null ? Number(row.filter_min_rating) : null,
  filterVerifiedOnly: row.filter_verified_only,
  filterPremiumOnly: row.filter_premium_only,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ---- Admin CRUD ----

export const list = async ({ search, page = 1, limit = 20 }) => {
  const { rows, total } = await collectionRepo.listForAdmin({ search, page, limit });
  return {
    collections: rows.map(serializeCollection),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};

export const getById = async (id) => {
  const collection = await collectionRepo.findById(id);
  if (!collection) throw new ServiceError(404, "Collection not found");
  const items = await collectionRepo.listItems(id);
  return { ...serializeCollection(collection), pinnedBusinessIds: items.map((i) => i.business_id) };
};

const buildInput = (input) => {
  const patch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.subtitle !== undefined) patch.subtitle = input.subtitle;
  if (input.coverImageUrl !== undefined) patch.cover_image_url = input.coverImageUrl;
  if (input.description !== undefined) patch.description = input.description;
  if (input.displayOrder !== undefined) patch.display_order = input.displayOrder;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.startAt !== undefined) patch.start_at = input.startAt;
  if (input.endAt !== undefined) patch.end_at = input.endAt;
  if (input.targetCity !== undefined) patch.target_city = input.targetCity;
  if (input.targetState !== undefined) patch.target_state = input.targetState;
  if (input.filterCategoryId !== undefined) patch.filter_category_id = input.filterCategoryId;
  if (input.filterMinRating !== undefined) patch.filter_min_rating = input.filterMinRating;
  if (input.filterVerifiedOnly !== undefined) patch.filter_verified_only = input.filterVerifiedOnly;
  if (input.filterPremiumOnly !== undefined) patch.filter_premium_only = input.filterPremiumOnly;
  return patch;
};

// Slugs must be unique; a title collision gets a numeric suffix rather than
// a 409 - the admin didn't ask to pick a slug, they typed a title.
const uniqueSlugFrom = async (title) => {
  const base = slugify(title) || "collection";
  let slug = base;
  let n = 2;
  while (await collectionRepo.findBySlug(slug)) {
    slug = `${base}-${n}`;
    n += 1;
  }
  return slug;
};

export const create = async (input, adminId) => {
  const slug = input.slug ? slugify(input.slug) : await uniqueSlugFrom(input.title);
  if (input.slug && (await collectionRepo.findBySlug(slug))) {
    throw new ServiceError(409, "A collection with this slug already exists");
  }

  const row = await collectionRepo.create({
    ...buildInput(input),
    title: input.title,
    slug,
    created_by: adminId,
  });
  return serializeCollection(row);
};

export const update = async (id, input) => {
  const patch = buildInput(input);
  if (input.slug !== undefined) {
    const slug = slugify(input.slug);
    const existing = await collectionRepo.findBySlug(slug);
    if (existing && existing.id !== id) throw new ServiceError(409, "A collection with this slug already exists");
    patch.slug = slug;
  }
  if (Object.keys(patch).length === 0) throw new ServiceError(400, "No fields to update");

  const updated = await collectionRepo.update(id, patch);
  if (!updated) throw new ServiceError(404, "Collection not found");
  return serializeCollection(updated);
};

export const remove = async (id) => {
  const deleted = await collectionRepo.remove(id);
  if (!deleted) throw new ServiceError(404, "Collection not found");
};

export const duplicate = async (id, adminId) => {
  const original = await collectionRepo.findById(id);
  if (!original) throw new ServiceError(404, "Collection not found");

  const slug = await uniqueSlugFrom(`${original.title} copy`);
  const copy = await collectionRepo.create({
    title: `${original.title} (copy)`,
    subtitle: original.subtitle,
    slug,
    cover_image_url: original.cover_image_url,
    description: original.description,
    display_order: original.display_order,
    is_active: false, // duplicates start inactive - an admin should review before publishing a clone
    start_at: null,
    end_at: null,
    target_city: original.target_city,
    target_state: original.target_state,
    filter_category_id: original.filter_category_id,
    filter_min_rating: original.filter_min_rating,
    filter_verified_only: original.filter_verified_only,
    filter_premium_only: original.filter_premium_only,
    created_by: adminId,
  });

  const items = await collectionRepo.listItems(id);
  for (const item of items) {
    await collectionRepo.addItem(copy.id, item.business_id);
  }

  return serializeCollection(copy);
};

// ---- Pinned items ----

export const pinBusiness = async (collectionId, businessId) => {
  const collection = await collectionRepo.findById(collectionId);
  if (!collection) throw new ServiceError(404, "Collection not found");
  await collectionRepo.addItem(collectionId, businessId);
  return collectionRepo.listItems(collectionId);
};

export const unpinBusiness = async (collectionId, businessId) => {
  await collectionRepo.removeItem(collectionId, businessId);
  return collectionRepo.listItems(collectionId);
};

export const reorderItems = async (collectionId, orderedBusinessIds) => {
  const existing = await collectionRepo.listItems(collectionId);
  const existingIds = new Set(existing.map((i) => i.business_id));
  const orderedIds = new Set(orderedBusinessIds);
  if (
    orderedBusinessIds.length !== existing.length ||
    orderedIds.size !== orderedBusinessIds.length ||
    !existing.every((i) => orderedIds.has(i.business_id))
  ) {
    throw new ServiceError(400, "orderedBusinessIds must match this collection's current pinned businesses exactly");
  }
  await collectionRepo.reorderItems(collectionId, orderedBusinessIds);
  return collectionRepo.listItems(collectionId);
};

// ---- Public / resolved feed ----

export const listActive = async ({ city } = {}) => {
  const rows = await collectionRepo.listActive();
  const filtered = city ? rows.filter((r) => !r.target_city || r.target_city.toLowerCase() === city.toLowerCase()) : rows;
  return filtered.map(serializeCollection);
};

const isPublished = (row) => {
  const now = Date.now();
  if (!row.is_active) return false;
  if (row.start_at && new Date(row.start_at).getTime() > now) return false;
  if (row.end_at && new Date(row.end_at).getTime() <= now) return false;
  return true;
};

// Public collection page's lookup - 404s on an inactive/scheduled/expired
// collection rather than leaking its existence to a slug guess. Deliberately
// separate from resolve()'s slug lookup, which admin live-preview also uses
// (via an already-loaded `collection`) and must NOT gate this way - previewing
// a not-yet-published collection is the entire point of that feature.
export const getPublishedBySlug = async (slug) => {
  const row = await collectionRepo.findBySlug(slug);
  if (!row || !isPublished(row)) throw new ServiceError(404, "Collection not found");
  return row;
};

/**
 * The one genuinely new query in this phase. `collection` may be passed in
 * already-loaded (admin live-preview, or the public path via
 * getPublishedBySlug above) or looked up by slug directly.
 */
export const resolve = async ({ collection, slug, page = 1, limit = 20 }) => {
  const row = collection ?? (await collectionRepo.findBySlug(slug));
  if (!row) throw new ServiceError(404, "Collection not found");

  const pinnedItemRows = await collectionRepo.listItems(row.id);
  const pinnedIds = pinnedItemRows.map((i) => i.business_id);

  const [pinnedResult, autoResult] = await Promise.all([
    pinnedIds.length > 0
      ? discoveryRepo.listBusinesses({ businessIds: pinnedIds, sortBy: "recommended", page: 1, limit: pinnedIds.length })
      : Promise.resolve({ rows: [] }),
    discoveryRepo.listBusinesses({
      categoryId: row.filter_category_id || undefined,
      minRating: row.filter_min_rating != null ? Number(row.filter_min_rating) : undefined,
      verifiedOnly: row.filter_verified_only || undefined,
      premiumOnly: row.filter_premium_only || undefined,
      city: row.target_city || undefined,
      excludeIds: pinnedIds,
      sortBy: "recommended",
      page: 1,
      limit: AUTO_FILL_POOL_SIZE,
    }),
  ]);

  // Pinned businesses keep the curator's own order, not the ranking order.
  const pinnedById = new Map(pinnedResult.rows.map((b) => [b.id, b]));
  const orderedPinned = pinnedItemRows.map((i) => pinnedById.get(i.business_id)).filter(Boolean);

  const combined = [...orderedPinned, ...autoResult.rows];
  const total = combined.length;
  const start = (page - 1) * limit;
  const pageRows = combined.slice(start, start + limit);

  return {
    collection: serializeCollection(row),
    businesses: pageRows.map((r) => ({ ...decorateBusinessCard(r), pinned: pinnedIds.includes(r.id) })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
};
