/**
 * Phase 1.2 - Business Information & Trust Layer (report.md V4 roadmap item #1).
 * Additive profile fields on `businesses`. Chosen over a `business_profile_details`
 * side table because every field is 1:1 with a business, all-optional metadata,
 * and mirrors the existing `amenities` jsonb column already on this table - so a
 * profile/discovery fetch stays a single-row read with no extra join.
 *
 * jsonb shapes:
 *   social_links     object  e.g. { instagram, facebook, twitter, youtube, tiktok, linkedin, whatsapp }
 *   languages        array   e.g. ["English", "Hindi"]
 *   payment_methods  array   e.g. ["Cash", "Card", "UPI"]
 *   policies         object  e.g. { cancellation, rescheduling, refund, general }
 *   accessibility    array   e.g. ["Wheelchair accessible", "Accessible parking"]
 *   house_rules      array   e.g. ["No outside food"]
 */
export const up = (knex) =>
  knex.schema.alterTable("businesses", (table) => {
    table.string("website", 500);
    table.jsonb("social_links").notNullable().defaultTo("{}");
    table.jsonb("languages").notNullable().defaultTo("[]");
    table.jsonb("payment_methods").notNullable().defaultTo("[]");
    table.jsonb("policies").notNullable().defaultTo("{}");
    table.jsonb("accessibility").notNullable().defaultTo("[]");
    table.jsonb("house_rules").notNullable().defaultTo("[]");
  });

export const down = (knex) =>
  knex.schema.alterTable("businesses", (table) => {
    table.dropColumn("website");
    table.dropColumn("social_links");
    table.dropColumn("languages");
    table.dropColumn("payment_methods");
    table.dropColumn("policies");
    table.dropColumn("accessibility");
    table.dropColumn("house_rules");
  });
