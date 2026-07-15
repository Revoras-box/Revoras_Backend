/**
 * Phase 1.3 - Professional Profile Enhancement (report.md V4 roadmap item #4).
 * Additive profile fields on `business_members` (the Professional entity - a
 * profile is membership-scoped here, same as the existing `specialties` /
 * `experience_years` / `image_url` columns already on this table).
 *
 * Reuses existing columns rather than duplicating: `specialties` = specializations,
 * `experience_years` = experience. Portfolio + certificate *image* uploads are a
 * separate step (1.3b) - a per-row media table like `business_gallery_images`,
 * MediaService-backed and release-gated.
 *
 * jsonb shapes:
 *   languages            array   ["English", "Hindi"]
 *   education            array   [{ institution, degree?, year? }]
 *   certifications       array   [{ name, issuer?, year? }]
 *   awards               array   [{ title, year? }]
 *   social_links         object  { instagram?, facebook?, twitter?, youtube?, tiktok?, linkedin?, website? }
 *   featured_service_ids array   [uuid]  (service ids this professional is known for)
 */
export const up = (knex) =>
  knex.schema.alterTable("business_members", (table) => {
    table.text("bio");
    table.jsonb("languages").notNullable().defaultTo("[]");
    table.jsonb("education").notNullable().defaultTo("[]");
    table.jsonb("certifications").notNullable().defaultTo("[]");
    table.jsonb("awards").notNullable().defaultTo("[]");
    table.jsonb("social_links").notNullable().defaultTo("{}");
    table.jsonb("featured_service_ids").notNullable().defaultTo("[]");
  });

export const down = (knex) =>
  knex.schema.alterTable("business_members", (table) => {
    table.dropColumn("bio");
    table.dropColumn("languages");
    table.dropColumn("education");
    table.dropColumn("certifications");
    table.dropColumn("awards");
    table.dropColumn("social_links");
    table.dropColumn("featured_service_ids");
  });
