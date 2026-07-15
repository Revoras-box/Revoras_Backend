/**
 * Phase 2.5 (Booking Experience) - the booking state machine's storage.
 *
 * Three changes, one migration:
 *  1. Add `checked_in` to the status CHECK constraint (decision D1). The strict
 *     transition matrix lives in bookingStateMachine.js; the DB constraint is
 *     the backstop that no row ever holds an unknown status.
 *  2. `booking_status_events` - an append-only log, one row per transition
 *     (decision D2). The customer/business "timeline" is just these rows
 *     ordered by time. Deliberately an event LOG, not per-status timestamp
 *     columns, so a future non-status event ("reminder sent") is another row,
 *     not another migration.
 *  3. Structured cancellation policy (decision D3): a per-business jsonb policy
 *     and a `cancellation_fee` snapshot on the booking. The fee is computed +
 *     recorded here; issuing a real refund is a later payments slice.
 */
const STATUS_CHECK = "status in ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show')";

// Sensible default so every existing business is immediately policy-aware
// without a data backfill: free up to 24h out, 50% fee after, hard-blocked
// within 2h (matches the old hardcoded 2h cutoff, now configurable).
const DEFAULT_CANCELLATION_POLICY = { freeBeforeHours: 24, feePercentAfter: 50, noCancelWithinHours: 2 };

export const up = async (knex) => {
  // 1. Widen the status constraint. Drop + re-add (Postgres has no ALTER CHECK).
  await knex.raw("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_bookings_status");
  await knex.raw(`ALTER TABLE bookings ADD CONSTRAINT chk_bookings_status CHECK (${STATUS_CHECK})`);

  // 2. Event log.
  await knex.schema.createTable("booking_status_events", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("booking_id").notNullable().references("id").inTable("bookings").onDelete("CASCADE");
    // from_status is null for the very first event (booking creation).
    table.string("from_status", 20);
    table.string("to_status", 20).notNullable();
    // Who caused it - a customer action, a business/staff action, or the system.
    table.enu("actor_type", ["customer", "business", "system"], { useNative: true, enumName: "booking_event_actor" }).notNullable();
    table.uuid("actor_id"); // the users/business_members id when known; null for system
    table.text("reason");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(["booking_id", "created_at"], "idx_booking_events_booking_time");
  });

  // 3. Cancellation policy + fee snapshot.
  await knex.schema.alterTable("businesses", (table) => {
    table.jsonb("cancellation_policy").notNullable().defaultTo(JSON.stringify(DEFAULT_CANCELLATION_POLICY));
  });
  await knex.schema.alterTable("bookings", (table) => {
    // Fee charged for a late cancellation, frozen at cancel time. 0 for a free
    // cancellation; null while the booking isn't cancelled.
    table.decimal("cancellation_fee", 10, 2);
  });
};

export const down = async (knex) => {
  await knex.schema.alterTable("bookings", (table) => table.dropColumn("cancellation_fee"));
  await knex.schema.alterTable("businesses", (table) => table.dropColumn("cancellation_policy"));
  await knex.schema.dropTableIfExists("booking_status_events");
  await knex.raw("DROP TYPE IF EXISTS booking_event_actor");

  // Restore the original (pre-checked_in) constraint. Any checked_in rows would
  // violate it, so roll them back to confirmed first (a rollback discards this
  // feature - checked_in has no meaning without it).
  await knex("bookings").where({ status: "checked_in" }).update({ status: "confirmed" });
  await knex.raw("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_bookings_status");
  await knex.raw(
    "ALTER TABLE bookings ADD CONSTRAINT chk_bookings_status CHECK (status in ('pending', 'confirmed', 'completed', 'cancelled', 'no_show'))"
  );
};
