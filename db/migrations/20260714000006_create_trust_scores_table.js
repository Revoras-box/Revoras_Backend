/**
 * Phase 1.4a - Trust Score & Metrics Engine. One cached row per business holding
 * the computed 0-100 trust score plus the raw metrics that feed it (so the
 * customer UI can show "98% appointments honored", "usually responds in 10 min",
 * etc. without recomputing). Recomputed by trust.service.recomputeTrustScore on
 * relevant events / lazily on read; the cache exists so discovery ranking (1.4c)
 * can sort on `score` cheaply instead of computing per row.
 */
export const up = (knex) =>
  knex.schema.createTable("trust_scores", (table) => {
    table.uuid("business_id").primary().references("id").inTable("businesses").onDelete("CASCADE");
    table.integer("score").notNullable().defaultTo(0);
    table.decimal("rating", 3, 2).notNullable().defaultTo(0);
    table.integer("review_count").notNullable().defaultTo(0);
    table.integer("completed_bookings").notNullable().defaultTo(0);
    table.decimal("cancellation_rate", 5, 4).notNullable().defaultTo(0);
    table.decimal("no_show_rate", 5, 4).notNullable().defaultTo(0);
    table.integer("profile_completion").notNullable().defaultTo(0);
    table.integer("avg_response_minutes");
    table.integer("business_age_days").notNullable().defaultTo(0);
    table.boolean("verified").notNullable().defaultTo(false);
    table.timestamp("computed_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["score"], "idx_trust_scores_score");
  });

export const down = (knex) => knex.schema.dropTableIfExists("trust_scores");
