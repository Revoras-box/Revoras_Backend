import knex from "../../db/knex.js";

/**
 * The single identity table's repository (report.md §2.0/§2.2) - full CRUD
 * and auth-security fields as of Phase 2.3 (report.md Phase 2 plan). Started
 * minimal in Phase 2.2 (findByEmail/findById only, for "add team member by
 * email"); this is now the real owner of the `users` table.
 */

const normalizeEmail = (email) => String(email).toLowerCase().trim();

export const findByEmail = (email, db = knex) => db("users").where({ email: normalizeEmail(email) }).first();

export const findByPhone = (phone, db = knex) => db("users").where({ phone }).first();

export const findByEmailOrPhone = (identifier, db = knex) =>
  db("users").where({ email: normalizeEmail(identifier) }).orWhere({ phone: identifier }).first();

export const findById = (id, db = knex) => db("users").where({ id }).first();

export const findByGoogleId = (googleId, db = knex) => db("users").where({ google_id: googleId }).first();

export const create = (row, db = knex) =>
  db("users")
    .insert({ ...row, email: row.email ? normalizeEmail(row.email) : row.email })
    .returning("*")
    .then((rows) => rows[0]);

export const setGoogleId = (id, googleId, db = knex) =>
  db("users")
    .where({ id })
    .update({ google_id: googleId, updated_at: db.fn.now() })
    .returning("*")
    .then((rows) => rows[0]);

// Bumps token_version too - a password change/reset revokes every JWT issued
// before it (report.md Phase 2.3 plan's lightweight revocation approach).
export const updatePassword = (id, hashedPassword, db = knex) =>
  db("users")
    .where({ id })
    .update({
      password: hashedPassword,
      token_version: db.raw("token_version + 1"),
      updated_at: db.fn.now(),
    });

export const bumpTokenVersion = (id, db = knex) =>
  db("users").where({ id }).update({ token_version: db.raw("token_version + 1"), updated_at: db.fn.now() });

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Per-account lockout, held in the database rather than in a limiter's memory:
// this survives a restart and is shared across instances, so an attacker cannot
// reset it by waiting out a deploy or landing on another node. authLimiter now
// also keys per account, but it is an in-memory second line of defence in front
// of this, not a replacement for it.
export const recordFailedLogin = async (id, db = knex) => {
  const [row] = await db("users")
    .where({ id })
    .update({ failed_login_attempts: db.raw("failed_login_attempts + 1"), updated_at: db.fn.now() })
    .returning(["failed_login_attempts"]);

  if (row.failed_login_attempts >= MAX_FAILED_ATTEMPTS) {
    await db("users")
      .where({ id })
      .update({
        locked_until: db.raw(`now() + interval '${LOCKOUT_MINUTES} minutes'`),
        failed_login_attempts: 0,
      });
  }
};

export const resetFailedLogin = (id, db = knex) =>
  db("users").where({ id }).update({ failed_login_attempts: 0, locked_until: null, updated_at: db.fn.now() });

const PROFILE_FIELDS = [
  "id",
  "email",
  "name",
  "phone",
  "avatar_url",
  "date_of_birth",
  "gender",
  "preferences",
  "notification_settings",
  "created_at",
  "updated_at",
];

export const findProfileById = (id, db = knex) => db("users").where({ id }).select(PROFILE_FIELDS).first();

export const updateProfile = (id, patch, db = knex) =>
  db("users")
    .where({ id })
    .update({ ...patch, updated_at: db.fn.now() })
    .returning(PROFILE_FIELDS)
    .then((rows) => rows[0]);

export const updateNotificationSettings = (id, settings, db = knex) =>
  db("users")
    .where({ id })
    .update({ notification_settings: JSON.stringify(settings), updated_at: db.fn.now() })
    .returning("notification_settings")
    .then((rows) => rows[0]?.notification_settings);

// Soft delete (report.md's established pattern - businesses/services/members
// all deactivate rather than hard-delete). Emails are unique, so a deleted
// account's email is disambiguated to free it up for reuse.
export const softDeactivate = (id, db = knex) =>
  db("users")
    .where({ id })
    .update({
      is_active: false,
      email: db.raw("concat('deleted_', id, '_', email)"),
      token_version: db.raw("token_version + 1"),
      updated_at: db.fn.now(),
    });

export const getBookingLoyaltyStats = async (id, db = knex) => {
  const row = await db("bookings")
    .where({ user_id: id })
    .select(
      db.raw("count(*) as total_bookings"),
      db.raw("count(*) filter (where status = 'completed') as completed_bookings"),
      db.raw("coalesce(sum(total_amount) filter (where status = 'completed'), 0) as total_spent")
    )
    .first();
  return row;
};
