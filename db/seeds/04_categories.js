/**
 * Upsert-by-slug rather than delete-then-insert: services.category_id is a
 * NOT NULL, ON DELETE RESTRICT reference (added in Phase 2.2, migration
 * 20260712000002), so a blind `del()` here would fail once any service
 * exists. Upserting also keeps category ids stable across reseeds instead of
 * re-minting them, which businesses.category_id/services.category_id would
 * otherwise dangle against.
 *
 * Two taxonomies share this one table, distinguished by `type`: "business"
 * (what kind of establishment - shown on businesses.category_id) and
 * "service" (what a service is - shown on services.category_id, and the
 * future customer "browse by category" rail).
 */
export const seed = async (knex) => {
  const rows = [
    { name: "Barbershop", slug: "barbershop", icon: "content_cut", sort_order: 1, type: "business" },
    { name: "Salon", slug: "salon", icon: "auto_awesome", sort_order: 2, type: "business" },
    { name: "Beauty Studio", slug: "beauty-studio", icon: "face_retouching_natural", sort_order: 3, type: "business" },
    { name: "Wellness & Spa", slug: "wellness-spa", icon: "spa", sort_order: 4, type: "business" },
    { name: "Nail Studio", slug: "nail-studio", icon: "brush", sort_order: 5, type: "business" },

    { name: "Haircut", slug: "haircut", icon: "content_cut", sort_order: 1, type: "service" },
    { name: "Beard", slug: "beard", icon: "face", sort_order: 2, type: "service" },
    { name: "Hair Color", slug: "hair-color", icon: "palette", sort_order: 3, type: "service" },
    { name: "Facial", slug: "facial", icon: "face_retouching_natural", sort_order: 4, type: "service" },
    { name: "Spa", slug: "spa", icon: "spa", sort_order: 5, type: "service" },
    { name: "Nails", slug: "nails", icon: "brush", sort_order: 6, type: "service" },
    { name: "Bridal", slug: "bridal", icon: "auto_awesome", sort_order: 7, type: "service" },
    // Catch-all fallback for anything that doesn't fit the taxonomy above -
    // also created directly by migration 20260712000002 if seeds haven't run
    // yet, so this just re-asserts the same row by slug.
    { name: "Other", slug: "other", icon: "category", sort_order: 99, type: "service" },
  ];

  await knex("categories").insert(rows).onConflict("slug").merge(["name", "icon", "sort_order", "type"]);
};
