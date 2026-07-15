// Unchanged in shape from before (report.md §1.5) - recreated here purely so
// Knex, not modelAttributeSync.js, is what a fresh database is built from.
export const up = (knex) =>
  knex.schema.createTable("verifications", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("identifier", 255).notNullable();
    table.string("otp", 10).notNullable();
    table.boolean("verified").notNullable().defaultTo(false);
    table.timestamp("verified_at", { useTz: true });
    table.boolean("consumed").notNullable().defaultTo(false);
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["identifier", "consumed", "expires_at"], "idx_verifications_identifier_consumed_expires");
  });

export const down = (knex) => knex.schema.dropTableIfExists("verifications");
