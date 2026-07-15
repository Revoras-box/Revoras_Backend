/**
 * Phase 1.5a - the canonical `business_status` lifecycle (design:
 * docs/business-lifecycle-state-machine.md, decisions O1-O5 locked 2026-07-15).
 *
 * Bridge migration: adds `business_status` as the authoritative source of truth
 * and backfills it from today's (approval_status, is_active) pair (O2). The
 * legacy columns are intentionally KEPT for now - BusinessLifecycleService
 * writes both in lockstep so not-yet-migrated admin readers keep working; they
 * are dropped in 1.5f once the admin UI (1.5e) reads business_status. So this
 * migration does not remove anything, it only adds + backfills + indexes.
 *
 * Lifecycle: draft -> onboarding -> payment_pending -> pending_review ->
 * under_review -> approved -> active, with suspended/rejected off it.
 */

const STATUSES = [
  "draft",
  "onboarding",
  "payment_pending",
  "pending_review",
  "under_review",
  "approved",
  "active",
  "suspended",
  "rejected",
];

export const up = async (knex) => {
  await knex.schema.alterTable("businesses", (table) => {
    table.string("business_status", 20).notNullable().defaultTo("draft");
  });

  // Backfill from the legacy pair (O2 mapping).
  await knex("businesses").where({ approval_status: "approved", is_active: true }).update({ business_status: "active" });
  await knex("businesses").where({ approval_status: "approved", is_active: false }).update({ business_status: "approved" });
  await knex("businesses").where({ approval_status: "pending" }).update({ business_status: "pending_review" });
  await knex("businesses").where({ approval_status: "rejected" }).update({ business_status: "rejected" });
  await knex("businesses").where({ approval_status: "suspended" }).update({ business_status: "suspended" });

  await knex.schema.alterTable("businesses", (table) => {
    table.check(
      `business_status in (${STATUSES.map((s) => `'${s}'`).join(", ")})`,
      [],
      "chk_businesses_business_status"
    );
    // Discovery's hot path is "active businesses in a category" (O5).
    table.index(["business_status", "category_id"], "idx_businesses_status_category");
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable("businesses", (table) => {
    table.dropChecks(["chk_businesses_business_status"]);
    table.dropIndex(["business_status", "category_id"], "idx_businesses_status_category");
    table.dropColumn("business_status");
  });
};
