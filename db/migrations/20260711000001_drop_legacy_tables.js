/**
 * Clean cutover from the old modelAttributeSync.js-managed schema to Knex.
 * This project has no production data (verified: 1 admin fixture, 2 test users,
 * 2 placeholder studios, everything else empty) - see report.md "Database Layer
 * Migration to Knex.js" for the audit. Dropped children-before-parents so FKs
 * don't block the drop regardless of what constraints the old sync system added.
 */
export const up = async (knex) => {
  await knex.raw(`
    DROP TABLE IF EXISTS
      admin_activity_log,
      review_helpful,
      user_favorites,
      booking_services,
      reviews,
      bookings,
      barber_time_off,
      studio_hours,
      services,
      barbers,
      studio_owners,
      studios,
      verifications,
      admins,
      users
    CASCADE;
  `);

  // Needed for the EXCLUDE constraint on bookings (migration 13).
  await knex.raw(`CREATE EXTENSION IF NOT EXISTS btree_gist;`);
};

export const down = async () => {
  // Deliberately no-op: this is a one-way cutover away from the old schema.
  // Rolling back would mean resurrecting modelAttributeSync.js's table shapes,
  // which no longer exist as model files. Restore from a DB backup if needed.
};
