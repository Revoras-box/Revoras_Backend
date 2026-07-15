import knex from "../../db/knex.js";

/**
 * Phase 2.2 (Discovery Curation System). `collections` is metadata + filter
 * criteria; `collection_items` is ONLY manually pinned businesses (curator
 * picks, in a specific order) - the rest of a collection's membership is
 * resolved live against discovery.repository.js's listBusinesses using the
 * collection's own filter_* columns (see collection.service.js's resolve).
 */

const COLLECTION_FIELDS = [
  "id",
  "title",
  "subtitle",
  "slug",
  "cover_image_url",
  "description",
  "display_order",
  "is_active",
  "start_at",
  "end_at",
  "target_city",
  "target_state",
  "filter_category_id",
  "filter_min_rating",
  "filter_verified_only",
  "filter_premium_only",
  "created_by",
  "created_at",
  "updated_at",
];

export const create = (row, db = knex) =>
  db("collections").insert(row).returning(COLLECTION_FIELDS).then((rows) => rows[0]);

export const findById = (id, db = knex) => db("collections").where({ id }).select(COLLECTION_FIELDS).first();

export const findBySlug = (slug, db = knex) => db("collections").where({ slug }).select(COLLECTION_FIELDS).first();

export const update = (id, patch, db = knex) =>
  db("collections")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(COLLECTION_FIELDS)
    .then((rows) => rows[0]);

export const remove = (id, db = knex) => db("collections").where({ id }).del();

export const listForAdmin = async ({ search, page = 1, limit = 20 }, db = knex) => {
  let query = db("collections").select(COLLECTION_FIELDS);
  let countQuery = db("collections");
  if (search) {
    query = query.andWhereILike("title", `%${search}%`);
    countQuery = countQuery.andWhereILike("title", `%${search}%`);
  }
  query = query.orderBy("display_order", "asc").orderBy("created_at", "desc").limit(limit).offset((page - 1) * limit);

  const [rows, [{ count }]] = await Promise.all([query, countQuery.count("* as count")]);
  return { rows, total: Number(count) };
};

// Public homepage feed - active AND currently within its optional publish
// window, ordered for display. Region targeting is applied later, per-viewer
// (collection.service.js), not here, since it needs the viewer's city.
export const listActive = (db = knex) =>
  db("collections")
    .select(COLLECTION_FIELDS)
    .where({ is_active: true })
    .andWhere((qb) => qb.whereNull("start_at").orWhere("start_at", "<=", db.fn.now()))
    .andWhere((qb) => qb.whereNull("end_at").orWhere("end_at", ">", db.fn.now()))
    .orderBy("display_order", "asc");

export const listItems = (collectionId, db = knex) =>
  db("collection_items").where({ collection_id: collectionId }).orderBy("sort_order", "asc");

export const addItem = (collectionId, businessId, db = knex) =>
  db("collection_items")
    .insert({
      collection_id: collectionId,
      business_id: businessId,
      sort_order: knex.raw(
        `coalesce((select max(sort_order) + 1 from collection_items where collection_id = ?), 0)`,
        [collectionId]
      ),
    })
    // Pinning an already-pinned business is a harmless no-op, not a 409 - the
    // admin UI's "pin" action shouldn't need to check membership first.
    .onConflict(["collection_id", "business_id"])
    .ignore()
    .returning("*")
    .then((rows) => rows[0]);

export const removeItem = (collectionId, businessId, db = knex) =>
  db("collection_items").where({ collection_id: collectionId, business_id: businessId }).del();

// Full replace, same contract as businessGallery.repository.js's
// reorderGallery - simplest shape for a drag-and-drop-shaped UI ("here is
// the new order"), even though this admin build uses move-up/down buttons
// rather than true drag-and-drop (see report.md V4.11 scope notes).
export const reorderItems = (collectionId, orderedBusinessIds, db = knex) =>
  db.transaction(async (trx) => {
    for (const [index, businessId] of orderedBusinessIds.entries()) {
      await trx("collection_items")
        .where({ collection_id: collectionId, business_id: businessId })
        .update({ sort_order: index });
    }
  });
