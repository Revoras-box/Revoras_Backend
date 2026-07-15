/**
 * Phase 2.4 (Offers & Promotions) - business-run discounts.
 *
 * `offers` holds the rule; `offer_services` scopes an offer to specific
 * services when `applies_to = 'services'`. An offer with `applies_to =
 * 'business'` has no offer_services rows and discounts any service.
 *
 * Deliberately NOT a generic promotions/coupon-code engine - there are no
 * customer-entered codes, no cross-business campaigns, no stacking. An offer
 * belongs to exactly one business and is discovered/auto-applied, matching the
 * marketplace model (Fresha/Booksy "deals"), not a Shopify discount system.
 *
 * Discount math and "which offer wins" live in offer.service.js (the offer
 * engine), not here - this migration only stores the rule. The applied result
 * is snapshotted onto `bookings` (see 20260715000011) so a later edit or
 * expiry can never rewrite the price of a booking already placed.
 */
export const up = async (knex) => {
  await knex.schema.createTable("offers", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("studio_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");

    table.string("title", 150).notNullable();
    table.string("description", 500);

    // 'flat' = discount_value is rupees off; 'percentage' = percent off (0-100).
    table.enu("discount_type", ["flat", "percentage"], { useNative: true, enumName: "offer_discount_type" }).notNullable();
    table.decimal("discount_value", 10, 2).notNullable();
    // Caps a percentage discount in absolute rupees (e.g. "20% off, up to ₹200").
    // Null = uncapped. Ignored for flat offers.
    table.decimal("max_discount_amount", 10, 2);
    // A booking's pre-discount total must reach this for the offer to apply.
    // Null/0 = no minimum.
    table.decimal("min_spend", 10, 2);

    // 'business' = any service; 'services' = only those in offer_services.
    table.enu("applies_to", ["business", "services"], { useNative: true, enumName: "offer_applies_to" }).notNullable().defaultTo("business");

    // Publish window. Null start = live immediately; null end = no expiry.
    table.timestamp("start_at", { useTz: true });
    table.timestamp("end_at", { useTz: true });
    table.boolean("is_active").notNullable().defaultTo(true);

    // Usage guards (Phase 2.4 decision D3). Usage is counted live from
    // bookings.offer_id, so there's no counter column to keep in sync.
    table.integer("max_uses"); // total across all customers; null = unlimited
    table.integer("max_uses_per_user"); // per customer; null = unlimited
    table.boolean("first_time_only").notNullable().defaultTo(false); // only a customer's first booking at this business

    table.uuid("created_by").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["studio_id", "is_active", "start_at", "end_at"], "idx_offers_studio_window");
  });

  await knex.schema.createTable("offer_services", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("offer_id").notNullable().references("id").inTable("offers").onDelete("CASCADE");
    table.uuid("service_id").notNullable().references("id").inTable("services").onDelete("CASCADE");

    table.unique(["offer_id", "service_id"], { indexName: "uq_offer_services_offer_service" });
    table.index("service_id", "idx_offer_services_service");
  });
};

export const down = async (knex) => {
  await knex.schema.dropTableIfExists("offer_services");
  await knex.schema.dropTableIfExists("offers");
  // useNative enums are Postgres types that outlive their table; drop them too.
  await knex.raw("DROP TYPE IF EXISTS offer_applies_to");
  await knex.raw("DROP TYPE IF EXISTS offer_discount_type");
};
