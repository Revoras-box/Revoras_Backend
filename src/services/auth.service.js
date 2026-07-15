import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import * as userRepo from "../repositories/user.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as permissionService from "./permission.service.js";
import { consumeVerificationProof } from "./verification.service.js";
import { ServiceError } from "../utils/ServiceError.js";

const BCRYPT_ROUNDS = 10;
const TOKEN_EXPIRY = "7d";
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Minimal JWT shape (report.md §2.0/§4.1) - `{ id, tv }`, no role or studioId
 * baked in. `tv` (token_version) is the revocation mechanism: a password
 * change/reset bumps it, which invalidates every token issued before that
 * point the next time authenticate.middleware.js checks it against the DB.
 * No refresh-token rotation - a deliberate scope decision (see report.md
 * Phase 2.3 plan), not an oversight; re-login after 7 days.
 */
const issueToken = (user) => jwt.sign({ id: user.id, tv: user.token_version }, process.env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

const sanitizeUser = (user) => {
  const { password, token_version, failed_login_attempts, locked_until, ...safe } = user;
  return safe;
};

const assertNotLocked = (user) => {
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const minutesLeft = Math.max(1, Math.ceil((new Date(user.locked_until) - new Date()) / 60000));
    throw new ServiceError(403, `Account temporarily locked after repeated failed logins. Try again in ${minutesLeft} minute(s).`);
  }
};

/**
 * Shared by customerLogin and businessLogin - people are one identity
 * (report.md §2.0), so "logging in" is the same operation regardless of
 * which page the request came from. What differs is what the response
 * includes afterward (business memberships, for the business-login page).
 */
const authenticateCredentials = async ({ email, phone, password }) => {
  if ((!email && !phone) || !password) {
    throw new ServiceError(400, "Email/phone and password are required");
  }

  const user = email ? await userRepo.findByEmail(email) : await userRepo.findByPhone(phone);
  if (!user) throw new ServiceError(401, "Invalid credentials");

  assertNotLocked(user);

  if (user.is_active === false) throw new ServiceError(403, "Account is deactivated");

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    await userRepo.recordFailedLogin(user.id);
    throw new ServiceError(401, "Invalid credentials");
  }

  await userRepo.resetFailedLogin(user.id);
  return user;
};

const resolveMembershipsWithPermissions = async (userId) => {
  const businesses = await businessRepo.listForUser(userId);
  return Promise.all(
    businesses.map(async (b) => {
      const permissions = await permissionService.getEffectivePermissions(b.member_id, b.role_id);
      return {
        studioId: b.id,
        businessName: b.name,
        businessSlug: b.slug,
        businessStatus: b.business_status, // Phase 1.5a - canonical lifecycle state
        approvalStatus: b.approval_status, // legacy mirror (bridge; removed in 1.5f)
        isActive: b.is_active,
        memberId: b.member_id,
        role: b.role,
        designation: b.designation,
        permissions: [...permissions],
      };
    })
  );
};

// ---- Customer ----

export const customerRegister = async ({ name, email, phone, password }) => {
  const verified = await consumeVerificationProof(email);
  if (!verified) throw new ServiceError(400, "Please verify your email before signing up");

  const existing = await userRepo.findByEmail(email);
  if (existing) throw new ServiceError(409, "Email already registered");

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

  let user;
  try {
    user = await userRepo.create({ name, email, phone: phone || null, password: hashed, email_verified: true });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) throw new ServiceError(409, "Email or phone already registered");
    throw err;
  }

  return { token: issueToken(user), user: sanitizeUser(user) };
};

export const customerLogin = async ({ email, phone, password }) => {
  const user = await authenticateCredentials({ email, phone, password });
  return { token: issueToken(user), user: sanitizeUser(user) };
};

// ---- Business ----

/**
 * Creates the User and the Business (via business.service.js's shared
 * transaction body) together, atomically - report.md Phase 2.3 plan's
 * registration transaction: Create Business, Create User, Create Business
 * Member (role=owner), seed default working hours, commit. If any step
 * fails, nothing is created, including the user account.
 */
export const businessRegister = async ({
  ownerName,
  email,
  phone,
  password,
  businessName,
  address,
  city,
  state,
  zipCode,
  country,
  designation,
  providesServices,
}) => {
  const [emailVerified, phoneVerified] = await Promise.all([
    consumeVerificationProof(email),
    consumeVerificationProof(phone),
  ]);
  if (!emailVerified || !phoneVerified) {
    throw new ServiceError(400, "Please verify both email and phone before signing up");
  }

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Deferred import - avoids a require cycle (business.service.js doesn't
  // depend on auth.service.js, but both live in the same directory and a
  // static top-of-file import here would be easy to accidentally cycle back
  // through later).
  const { createBusinessCore } = await import("./business.service.js");

  const result = await businessRepo.runInTransaction(async (trx) => {
    let user;
    try {
      user = await userRepo.create({ name: ownerName, email, phone, password: hashed, email_verified: true, phone_verified: true }, trx);
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) throw new ServiceError(409, "Email or phone already registered");
      throw err;
    }

    const business = await createBusinessCore(trx, user.id, {
      name: businessName,
      address,
      city,
      state,
      zipCode,
      country,
      designation,
      providesServices,
    });

    return { user, business };
  });

  const memberships = await resolveMembershipsWithPermissions(result.user.id);

  return { token: issueToken(result.user), user: sanitizeUser(result.user), business: result.business, memberships };
};

/**
 * Phase 1.5a - host signup. Unlike businessRegister (a full one-shot that lands
 * the business straight in review), this creates the account plus a **DRAFT**
 * business carrying only its name; the owner then completes Business Basics,
 * services, gallery, hours and documents through the onboarding wizard, which
 * walks the business forward via BusinessLifecycleService. Same identity model
 * (a User who owns a Business via a business_members owner row) and the same
 * email+phone verification requirement - no weaker security for hosts.
 */
export const hostRegister = async ({ ownerName, email, phone, password, businessName }) => {
  const [emailVerified, phoneVerified] = await Promise.all([
    consumeVerificationProof(email),
    consumeVerificationProof(phone),
  ]);
  if (!emailVerified || !phoneVerified) {
    throw new ServiceError(400, "Please verify both email and phone before signing up");
  }

  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { createBusinessCore } = await import("./business.service.js");

  const result = await businessRepo.runInTransaction(async (trx) => {
    let user;
    try {
      user = await userRepo.create({ name: ownerName, email, phone, password: hashed, email_verified: true, phone_verified: true }, trx);
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION) throw new ServiceError(409, "Email or phone already registered");
      throw err;
    }

    // DRAFT business, name only; address et al. are filled in Step 1 of the wizard.
    const business = await createBusinessCore(trx, user.id, { name: businessName, status: "draft" });
    return { user, business };
  });

  const memberships = await resolveMembershipsWithPermissions(result.user.id);
  return { token: issueToken(result.user), user: sanitizeUser(result.user), business: result.business, memberships };
};

/**
 * Owners and staff share this one endpoint (report.md Phase 2.3 plan -
 * "do not maintain separate Owner Login and Barber Login endpoints").
 * Authenticates the person, then resolves every active business membership
 * and its effective permissions so the frontend can pick/display the right
 * dashboard without a second round trip.
 */
export const businessLogin = async ({ email, phone, password }) => {
  const user = await authenticateCredentials({ email, phone, password });
  const memberships = await resolveMembershipsWithPermissions(user.id);

  return { token: issueToken(user), user: sanitizeUser(user), memberships };
};

// ---- Shared ----

export const me = async (userId) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new ServiceError(404, "User not found");

  const memberships = await resolveMembershipsWithPermissions(userId);
  return { user: sanitizeUser(user), memberships };
};

export const changePassword = async (userId, { currentPassword, newPassword }) => {
  const user = await userRepo.findById(userId);
  if (!user) throw new ServiceError(404, "User not found");

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) throw new ServiceError(401, "Current password is incorrect");

  const hashed = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await userRepo.updatePassword(userId, hashed);
};
