/**
 * Phase 1.3c - Certificate consolidation. `member_certificates` (1.3b) becomes
 * the single source of truth; the temporary jsonb `business_members.certifications`
 * (1.3a) is migrated into it and then dropped. No two sources of truth.
 *
 * Legacy jsonb shape was { name, issuer?, year? }. It maps to member_certificates
 * as title=name, issuer=issuer (fallback "Unknown" since the table requires it);
 * `year` (a bare year string) has no date column and is intentionally not carried.
 */
export const up = async (knex) => {
  const members = await knex("business_members")
    .whereRaw("jsonb_array_length(certifications) > 0")
    .select("id", "certifications");

  for (const member of members) {
    const certs = Array.isArray(member.certifications) ? member.certifications : [];
    let sortOrder = 0;
    for (const c of certs) {
      if (!c || !c.name) continue;
      await knex("member_certificates").insert({
        business_member_id: member.id,
        title: String(c.name).slice(0, 200),
        issuer: String(c.issuer || "Unknown").slice(0, 200),
        sort_order: sortOrder,
      });
      sortOrder += 1;
    }
  }

  await knex.schema.alterTable("business_members", (table) => {
    table.dropColumn("certifications");
  });
};

// Restores the column shape (not the migrated data - that now lives in
// member_certificates and is the source of truth going forward).
export const down = (knex) =>
  knex.schema.alterTable("business_members", (table) => {
    table.jsonb("certifications").notNullable().defaultTo("[]");
  });
