/**
 * Business documents (PAN / GST / other). A plain compulsory upload collected
 * during onboarding - NOT the verification workflow (business_verification_*),
 * which is eligibility-gated and admin-reviewed and can't be satisfied by a
 * brand-new business. One row per uploaded file; the file itself lives in object
 * storage (R2), this table holds the type + public URL + original filename.
 */
export const up = (knex) =>
  knex.schema.createTable("business_documents", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("studio_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    // pan | gst | other - a label, not a verified claim.
    table.string("doc_type", 40).notNullable();
    table.string("url", 500).notNullable();
    table.string("original_name", 255);
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["studio_id", "created_at"], "idx_business_documents_studio_created");
  });

export const down = (knex) => knex.schema.dropTableIfExists("business_documents");
