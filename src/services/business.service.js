import * as businessRepo from "../repositories/business.repository.js";
import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as categoryRepo from "../repositories/category.repository.js";
import * as workingHoursRepo from "../repositories/workingHours.repository.js";
import * as mediaService from "./media.service.js";
import { ServiceError } from "../utils/ServiceError.js";

const PG_UNIQUE_VIOLATION = "23505";

const DEFAULT_WORKING_HOURS = [
  { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true }, // Sunday
  { dayOfWeek: 1, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 2, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 3, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 4, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 5, openTime: "09:00", closeTime: "19:00", isClosed: false },
  { dayOfWeek: 6, openTime: "10:00", closeTime: "18:00", isClosed: false },
];

const slugify = (name) =>
  String(name)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200) || "business";

const assertBusinessCategory = async (categoryId) => {
  if (categoryId === undefined || categoryId === null) return;
  const category = await categoryRepo.findById(categoryId);
  if (!category || category.type !== "business") {
    throw new ServiceError(400, "categoryId must reference a business-type category");
  }
};

/**
 * The shared transaction body behind both "an existing logged-in user opens
 * a second business" (createBusiness, below) and "a brand-new person
 * self-registers a business" (auth.service.js's businessRegister, which
 * creates the user row first then calls this within the *same* outer
 * transaction). Must run inside a transaction the caller owns - it does not
 * open one itself, so it can be nested via trx.transaction() (a Postgres
 * SAVEPOINT) when a caller like businessRegister needs it inside a larger
 * transaction.
 */
export const createBusinessCore = async (trx, userId, input) => {
  await assertBusinessCategory(input.categoryId);

  const ownerRole = await businessRepo.findRoleByKey("owner", trx);
  if (!ownerRole) throw new ServiceError(500, "Owner role is not seeded");

  const baseSlug = slugify(input.name);
  let slug = baseSlug;
  let created;

  // Bounded retry on slug collision instead of a check-then-insert race (two
  // owners naming a business the same thing at the same time). Each attempt
  // runs in its own nested transaction (Postgres SAVEPOINT via Knex) - a
  // plain retry inside the same transaction doesn't work because Postgres
  // poisons the whole transaction after any failed statement ("current
  // transaction is aborted") until it's rolled back; only the savepoint
  // needs rolling back here, not the rest of this transaction.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      created = await trx.transaction((savepoint) =>
        businessRepo.create(
          {
            name: input.name,
            slug,
            category_id: input.categoryId || null,
            address: input.address,
            city: input.city || null,
            state: input.state || null,
            zip_code: input.zipCode || null,
            country: input.country || null,
            phone: input.phone || null,
            email: input.email || null,
            description: input.description || null,
            // Phase 1.5a lifecycle status. Host signup creates a DRAFT the owner
            // fills via the onboarding wizard; the legacy one-shot
            // businessRegister submits straight to review. The legacy
            // approval_status/is_active keep their schema defaults, which the
            // lifecycle mirror matches for both.
            business_status: input.status || "pending_review",
          },
          savepoint
        )
      );
      break;
    } catch (err) {
      if (err.code === PG_UNIQUE_VIOLATION && attempt < 4) {
        slug = `${baseSlug}-${attempt + 2}`;
        continue;
      }
      throw err;
    }
  }

  const member = await businessMemberRepo.create(
    {
      studio_id: created.id,
      user_id: userId,
      role_id: ownerRole.id,
      designation: input.designation || "Owner",
      provides_services: input.providesServices !== false,
      status: "active",
    },
    trx
  );

  for (const day of DEFAULT_WORKING_HOURS) {
    await workingHoursRepo.upsertDay(trx, created.id, day);
  }

  return { ...created, member: { ...member, role: "owner" } };
};

/**
 * A logged-in user creates a business and becomes its Owner in the same
 * transaction (report.md §2.0 - business_members is the only bridge between
 * Business and User, so a new business is never valid without an owner row).
 * Stays new/pending/inactive by schema default until Phase 2.5's admin
 * approval flow flips it - not this service's concern.
 */
export const createBusiness = (userId, input) =>
  businessRepo.runInTransaction((trx) => createBusinessCore(trx, userId, input));

export const listMyBusinesses = (userId) => businessRepo.listForUser(userId);

export const getBusiness = async (studioId) => {
  const business = await businessRepo.findById(studioId);
  if (!business) throw new ServiceError(404, "Business not found");
  return business;
};

// Authorization (only owners with settings.manage may call this) is enforced
// by requirePermission at the route level, not here - report.md Phase 2.3
// plan's "controllers/services hold no permission logic" rule.
export const updateBusiness = async (studioId, input) => {
  await assertBusinessCategory(input.categoryId);

  const patch = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.categoryId !== undefined) patch.category_id = input.categoryId;
  if (input.address !== undefined) patch.address = input.address;
  if (input.city !== undefined) patch.city = input.city;
  if (input.state !== undefined) patch.state = input.state;
  if (input.zipCode !== undefined) patch.zip_code = input.zipCode;
  if (input.country !== undefined) patch.country = input.country;
  if (input.lat !== undefined) patch.lat = input.lat;
  if (input.lng !== undefined) patch.lng = input.lng;
  if (input.phone !== undefined) patch.phone = input.phone;
  if (input.email !== undefined) patch.email = input.email;
  if (input.description !== undefined) patch.description = input.description;
  if (input.imageUrl !== undefined) patch.image_url = input.imageUrl;
  if (input.logoUrl !== undefined) patch.logo_url = input.logoUrl;
  if (input.bannerUrl !== undefined) patch.banner_url = input.bannerUrl;
  if (input.amenities !== undefined) patch.amenities = JSON.stringify(input.amenities);
  // Phase 1.2 - jsonb columns are stringified on write, same as amenities above.
  if (input.website !== undefined) patch.website = input.website;
  if (input.socialLinks !== undefined) patch.social_links = JSON.stringify(input.socialLinks);
  if (input.languages !== undefined) patch.languages = JSON.stringify(input.languages);
  if (input.paymentMethods !== undefined) patch.payment_methods = JSON.stringify(input.paymentMethods);
  if (input.policies !== undefined) patch.policies = JSON.stringify(input.policies);
  if (input.cancellationPolicy !== undefined) patch.cancellation_policy = JSON.stringify(input.cancellationPolicy);
  if (input.reschedulePolicy !== undefined) patch.reschedule_policy = JSON.stringify(input.reschedulePolicy);
  if (input.accessibility !== undefined) patch.accessibility = JSON.stringify(input.accessibility);
  if (input.houseRules !== undefined) patch.house_rules = JSON.stringify(input.houseRules);

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(400, "No fields to update");
  }

  return businessRepo.update(studioId, patch);
};

export const deactivateBusiness = async (studioId) => {
  await businessRepo.setActive(studioId, false);
};

/**
 * First real caller of MediaService (report.md Phase 0.1 plan) - every
 * future upload (professional portfolios, service photos, offers, reviews,
 * certificates, business gallery) should follow this same shape: validate
 * the file exists, delegate to mediaService.replaceMedia/uploadMedia, then
 * persist only the returned public URL. Never call storageProvider or the
 * AWS SDK from a controller or service directly.
 */
export const uploadBusinessLogo = async (studioId, file) => {
  if (!file) {
    throw new ServiceError(400, "No file uploaded");
  }

  const business = await getBusiness(studioId);

  const { url } = await mediaService.replaceMedia({
    buffer: file.buffer,
    originalFilename: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    folder: mediaService.MEDIA_FOLDERS.BUSINESSES,
    entityId: studioId,
    prefix: "logo",
    previousUrl: business.logo_url,
  });

  return businessRepo.update(studioId, { logo_url: url });
};
