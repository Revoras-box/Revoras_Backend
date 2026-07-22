/**
 * Phase 4A - Explore Map. A dense cluster of ACTIVE businesses across real
 * Bengaluru neighbourhoods, so the map is actually developable: panning,
 * viewport loading, "Search this area", and eventual clustering all need
 * several pins close together, which no other seed provides (06 has one,
 * 07 has one in Srinagar).
 *
 * Bengaluru on purpose - one city, tightly packed - rather than one business
 * per metro: spreading a dozen pins across the country would zoom the map out
 * to where none of the viewport behaviour is exercisable. Coordinates are real
 * neighbourhood centres so the CARTO basemap labels line up with the pins.
 *
 * Idempotent by slug (all share the `map-` prefix), matching the delete-then-
 * insert pattern the other fixtures use. Dev/demo only - real businesses set
 * their own pin through the onboarding Location step.
 */

// Real Bengaluru neighbourhood coordinates. Kept close together (all within
// ~12km) so they share a viewport at city zoom.
const FIXTURES = [
  { name: "Fade Republic", area: "Koramangala", category: "barbershop", lat: 12.9352, lng: 77.6245, rating: 4.8, reviews: 214, from: 249 },
  { name: "The Gilded Chair", area: "Indiranagar", category: "barbershop", lat: 12.9719, lng: 77.6412, rating: 4.9, reviews: 411, from: 349 },
  { name: "Lush & Co. Salon", area: "Jayanagar", category: "salon", lat: 12.9250, lng: 77.5938, rating: 4.6, reviews: 158, from: 399 },
  { name: "Halcyon Beauty Studio", area: "HSR Layout", category: "beauty-studio", lat: 12.9116, lng: 77.6389, rating: 4.7, reviews: 92, from: 299 },
  { name: "Stillwater Wellness & Spa", area: "Whitefield", category: "wellness-spa", lat: 12.9698, lng: 77.7500, rating: 4.9, reviews: 276, from: 899 },
  { name: "Lacquer Lane Nail Studio", area: "MG Road", category: "nail-studio", lat: 12.9757, lng: 77.6060, rating: 4.5, reviews: 63, from: 199 },
  { name: "Sharp & Sons", area: "BTM Layout", category: "barbershop", lat: 12.9166, lng: 77.6101, rating: 4.4, reviews: 121, from: 199 },
  { name: "Rosewood Salon", area: "Malleshwaram", category: "salon", lat: 13.0035, lng: 77.5709, rating: 4.7, reviews: 187, from: 449 },
  { name: "Amara Skin & Beauty", area: "JP Nagar", category: "beauty-studio", lat: 12.9077, lng: 77.5851, rating: 4.6, reviews: 74, from: 349 },
  { name: "Serene Ash Spa", area: "Electronic City", category: "wellness-spa", lat: 12.8452, lng: 77.6602, rating: 4.8, reviews: 203, from: 799 },
  { name: "Blade & Barrel", area: "Ulsoor", category: "barbershop", lat: 12.9820, lng: 77.6295, rating: 4.5, reviews: 98, from: 279 },
  { name: "Petal & Poise Nails", area: "Bellandur", category: "nail-studio", lat: 12.9260, lng: 77.6762, rating: 4.4, reviews: 51, from: 229 },
];

// Deterministic placeholder imagery so cards aren't blank on the map list.
const IMG = (seed) => `https://picsum.photos/seed/revoras-${seed}/800/600`;

const slugify = (name) => "map-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const seed = async (knex) => {
  const slugs = FIXTURES.map((f) => slugify(f.name));

  // FK-safe teardown: services/working_hours/members reference businesses, but
  // these fixtures never create those, so removing the businesses is enough.
  await knex("businesses").whereIn("slug", slugs).del();

  const categories = await knex("categories").where({ type: "business" }).select("id", "slug");
  const catBySlug = Object.fromEntries(categories.map((c) => [c.slug, c.id]));

  const rows = FIXTURES.map((f) => ({
    name: f.name,
    slug: slugify(f.name),
    category_id: catBySlug[f.category] || null,
    address: `${f.area}, Bengaluru`,
    city: "Bengaluru",
    state: "Karnataka",
    country: "India",
    lat: f.lat,
    lng: f.lng,
    rating: f.rating,
    review_count: f.reviews,
    image_url: IMG(slugify(f.name)),
    description: `${f.name} — a ${f.area} favourite. Walk-ins welcome, from ₹${f.from}.`,
    approval_status: "approved",
    is_active: true,
    business_status: "active", // must be ACTIVE to surface in discovery/map
  }));

  await knex("businesses").insert(rows);

  console.log(`[seed] Map fixtures ready: ${rows.length} active businesses across Bengaluru (slugs map-*)`);
};
