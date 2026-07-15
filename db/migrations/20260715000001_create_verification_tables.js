/**
 * Phase 1.4b - Verification workflow + Admin queue (report.md §V4.7). The
 * business-trust verification flow, deliberately NOT reusing the `verifications`
 * table (migration 20) or verification.service.js - those are the signup
 * email/phone OTP flow. Four tables:
 *
 *  - verification_requests   one row per verification attempt by a business.
 *                            Lifecycle: draft -> submitted -> under_review ->
 *                            approved | rejected | suspended, with a
 *                            more_info detour. A partial unique index keeps at
 *                            most one *open* request per business (a business
 *                            can have many closed ones over time).
 *  - verification_documents  uploaded proof docs (R2 urls) attached to a request.
 *  - verification_history    append-only audit of every status transition
 *                            (who, from->to, when) - powers the timeline UI.
 *  - verification_notes      admin-internal moderation notes. NEVER exposed on
 *                            any public/business-facing endpoint.
 *
 * Approval flips trust_scores.verified = true and recomputes the score (the
 * `verification` weight in trust.service.computeScore); rejection/suspension
 * flips it back. Verification (is this business who it claims to be) is
 * orthogonal to businesses.approval_status (may this business be listed) - the
 * two are kept separate on purpose.
 */

const OPEN_STATUSES = ["draft", "submitted", "under_review", "more_info"];
const ALL_STATUSES = [...OPEN_STATUSES, "approved", "rejected", "suspended"];

export const up = async (knex) => {
  await knex.schema.createTable("verification_requests", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    table.string("status", 20).notNullable().defaultTo("draft");
    // Snapshot of the trust metrics at submit time (the auto-eligibility check
    // result), so a later change to thresholds doesn't rewrite history.
    table.jsonb("eligibility_snapshot").notNullable().defaultTo("{}");
    table.text("applicant_note"); // business's own message to the reviewer
    table.text("decision_reason"); // reviewer's reason on reject/suspend/more_info
    table.uuid("reviewed_by").references("id").inTable("admins").onDelete("SET NULL");
    table.timestamp("submitted_at", { useTz: true });
    table.timestamp("reviewed_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check(
      `status in (${ALL_STATUSES.map((s) => `'${s}'`).join(", ")})`,
      [],
      "chk_verification_requests_status"
    );
    table.index(["status", "submitted_at"], "idx_verification_requests_status_submitted");
    table.index(["business_id"], "idx_verification_requests_business");
  });

  // At most one open request per business; closed requests are unconstrained so
  // a business can re-apply after a rejection.
  await knex.schema.raw(
    `create unique index idx_verification_requests_one_open
     on verification_requests (business_id)
     where status in (${OPEN_STATUSES.map((s) => `'${s}'`).join(", ")})`
  );

  await knex.schema.createTable("verification_documents", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("request_id").notNullable().references("id").inTable("verification_requests").onDelete("CASCADE");
    table.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    table.string("type", 40).notNullable(); // business_license | id_proof | address_proof | other
    table.string("url", 500).notNullable();
    table.string("original_name", 255);
    table.string("status", 20).notNullable().defaultTo("pending"); // pending | accepted | rejected
    table.text("review_note");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("status in ('pending', 'accepted', 'rejected')", [], "chk_verification_documents_status");
    table.index(["request_id"], "idx_verification_documents_request");
  });

  await knex.schema.createTable("verification_history", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("request_id").notNullable().references("id").inTable("verification_requests").onDelete("CASCADE");
    table.uuid("business_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    table.string("from_status", 20);
    table.string("to_status", 20).notNullable();
    table.string("actor_type", 10).notNullable(); // business | admin | system
    table.uuid("actor_id"); // user or admin id; null for system
    table.text("note");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.check("actor_type in ('business', 'admin', 'system')", [], "chk_verification_history_actor");
    table.index(["request_id", "created_at"], "idx_verification_history_request");
  });

  await knex.schema.createTable("verification_notes", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("request_id").notNullable().references("id").inTable("verification_requests").onDelete("CASCADE");
    table.uuid("admin_id").references("id").inTable("admins").onDelete("SET NULL");
    table.text("note").notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["request_id", "created_at"], "idx_verification_notes_request");
  });
};

export const down = async (knex) => {
  await knex.schema.dropTableIfExists("verification_notes");
  await knex.schema.dropTableIfExists("verification_history");
  await knex.schema.dropTableIfExists("verification_documents");
  await knex.schema.dropTableIfExists("verification_requests");
};
