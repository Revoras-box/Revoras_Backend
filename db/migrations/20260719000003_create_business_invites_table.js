/**
 * Lets an owner add a professional who has no Revoras account yet.
 *
 * This cannot live on `business_members`: that table's `user_id` is NOT NULL
 * (20260711000008), and an invited person has no user row to point at until
 * they accept. So the invite is its own record, and accepting it is what
 * creates the membership.
 *
 * `email` is nullable on purpose. A salon owner in India often has a barber's
 * phone number and nothing else - requiring an email address would rebuild the
 * exact dead end this table exists to remove. When there's no email the owner
 * shares the invite link themselves (WhatsApp), which is why the link is the
 * primary artifact and the email is only a convenience delivery of it.
 *
 * Token handling mirrors password_reset_tokens: store SHA-256 of the token, not
 * the token, so a database read cannot hand out a working invite.
 */
export const up = async (knex) => {
  await knex.schema.createTable("business_invites", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("studio_id").notNullable().references("id").inTable("businesses").onDelete("CASCADE");
    table.uuid("role_id").notNullable().references("id").inTable("roles").onDelete("RESTRICT");
    table.uuid("invited_by").references("id").inTable("users").onDelete("SET NULL");

    table.string("name", 120).notNullable();
    table.string("email", 255);
    table.string("phone", 20);

    // Carried on the invite so the member row can be created exactly as the
    // owner intended it, without them re-entering anything after acceptance.
    table.string("designation", 100);
    table.boolean("provides_services").notNullable().defaultTo(true);
    table.integer("experience_years").notNullable().defaultTo(0);

    table.string("token_hash", 64).notNullable().unique();
    table.timestamp("expires_at", { useTz: true }).notNullable();
    table.timestamp("accepted_at", { useTz: true });
    table.uuid("accepted_user_id").references("id").inTable("users").onDelete("SET NULL");
    table.timestamp("revoked_at", { useTz: true });
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["studio_id"], "idx_business_invites_studio");
  });

  // "Pending" is derived from the three timestamps rather than stored as a
  // status column, for the same reason review replies derive theirs from
  // `reply` being null: a status column is a second source of truth that can
  // disagree with the timestamps. This partial index makes the derived
  // predicate cheap, and enforces one live invite per person per business so a
  // double-click cannot mint two working links.
  await knex.raw(`
    CREATE UNIQUE INDEX uq_business_invites_pending_email
      ON business_invites (studio_id, lower(email))
      WHERE accepted_at IS NULL AND revoked_at IS NULL AND email IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX uq_business_invites_pending_phone
      ON business_invites (studio_id, phone)
      WHERE accepted_at IS NULL AND revoked_at IS NULL AND phone IS NOT NULL
  `);
};

export const down = (knex) => knex.schema.dropTableIfExists("business_invites");
