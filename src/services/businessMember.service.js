import * as businessMemberRepo from "../repositories/businessMember.repository.js";
import * as businessRepo from "../repositories/business.repository.js";
import * as userRepo from "../repositories/user.repository.js";
import * as portfolioRepo from "../repositories/portfolio.repository.js";
import * as certificateRepo from "../repositories/certificate.repository.js";
import * as employeeServiceRepo from "../repositories/employeeService.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

const PG_UNIQUE_VIOLATION = "23505";

export const listMembers = (studioId) => businessMemberRepo.listForStudio(studioId);

// Phase 1.3 - "how filled-out is this profile" signal. Computed on read (never
// stored, so it can't drift). Portfolio/certificate counts come from their own
// tables post-consolidation (Phase 1.3c), not a jsonb field.
export const computeProfileCompletion = (m, portfolioCount = 0, certCount = 0) => {
  const checks = [
    !!m.designation,
    !!m.bio,
    !!m.image_url,
    (m.specialties?.length ?? 0) > 0,
    (m.experience_years ?? 0) > 0,
    (m.languages?.length ?? 0) > 0,
    (m.education?.length ?? 0) > 0,
    (m.awards?.length ?? 0) > 0,
    Object.keys(m.social_links ?? {}).length > 0,
    portfolioCount > 0,
    certCount > 0,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
};

// Actionable hints (not a bare percentage) for what's still missing.
export const computeMissing = (m, portfolioCount = 0, certCount = 0) => {
  const items = [];
  if (!m.bio) items.push("Add a bio");
  if ((m.languages?.length ?? 0) === 0) items.push("Add languages");
  if ((m.education?.length ?? 0) === 0) items.push("Add education");
  if ((m.awards?.length ?? 0) === 0) items.push("Add awards");
  if (Object.keys(m.social_links ?? {}).length === 0) items.push("Add social links");
  if (portfolioCount === 0) items.push("Complete your portfolio");
  if (certCount === 0) items.push("Add certifications");
  return items;
};

export const getMember = async (studioId, memberId) => {
  const member = await businessMemberRepo.findByIdForStudio(memberId, studioId);
  if (!member) throw new ServiceError(404, "Team member not found");
  const [portfolioCount, certCount] = await Promise.all([
    portfolioRepo.count(memberId),
    certificateRepo.count(memberId),
  ]);
  return {
    ...member,
    profile_completion: computeProfileCompletion(member, portfolioCount, certCount),
    profile_missing: computeMissing(member, portfolioCount, certCount),
  };
};

/**
 * Links an EXISTING user to a business as Owner or Staff. Deliberately does
 * not create a new user account or send an invite email - account creation
 * and notifications are Phase 2.4's job (report.md Phase 2 plan). The person
 * must already have signed up with this email first. Authorization
 * (team.manage) is enforced by requirePermission at the route level, not
 * here - report.md Phase 2.3 plan's "controllers/services hold no permission
 * logic" rule.
 */
export const addMember = async (studioId, input) => {
  const user = await userRepo.findByEmail(input.email);
  if (!user) {
    throw new ServiceError(404, "No account found for that email - they need to sign up first");
  }

  const role = await businessRepo.findRoleByKey(input.roleKey);
  if (!role) throw new ServiceError(400, "Invalid role");

  try {
    const member = await businessMemberRepo.create({
      studio_id: studioId,
      user_id: user.id,
      role_id: role.id,
      designation: input.designation || null,
      provides_services: input.providesServices,
      specialties: JSON.stringify(input.specialties || []),
      experience_years: input.experienceYears || 0,
      status: "active",
    });

    // A new professional starts out performing everything the shop sells, at
    // catalogue durations, so they're bookable from the moment they're added.
    // The owner then adjusts which services they actually do and how long THEY
    // take, which is what sets their scheduling rhythm.
    if (member.provides_services) {
      await employeeServiceRepo.seedCatalogueForMember(member.id, studioId);
    }

    return { ...member, role: input.roleKey, name: user.name, email: user.email };
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      throw new ServiceError(409, "This person is already a member of this business");
    }
    throw err;
  }
};

// Genuine business invariant, not authorization - stays here regardless of
// what requirePermission already checked at the route level.
const assertNotLastOwner = async (studioId, member) => {
  if (member.role !== "owner") return;

  const ownerCount = await businessMemberRepo.countActiveOwners(studioId);
  if (ownerCount <= 1) {
    throw new ServiceError(400, "Cannot remove or demote the only owner - assign another owner first");
  }
};

export const updateMember = async (studioId, memberId, input) => {
  const member = await businessMemberRepo.findByIdForStudio(memberId, studioId);
  if (!member) throw new ServiceError(404, "Team member not found");

  const demotingOrDeactivating =
    (input.roleKey && input.roleKey !== "owner" && member.role === "owner") ||
    (input.status && input.status !== "active" && member.role === "owner");
  if (demotingOrDeactivating) {
    await assertNotLastOwner(studioId, member);
  }

  const patch = {};
  if (input.roleKey !== undefined) {
    const role = await businessRepo.findRoleByKey(input.roleKey);
    if (!role) throw new ServiceError(400, "Invalid role");
    patch.role_id = role.id;
  }
  if (input.designation !== undefined) patch.designation = input.designation;
  if (input.providesServices !== undefined) patch.provides_services = input.providesServices;
  if (input.specialties !== undefined) patch.specialties = JSON.stringify(input.specialties);
  if (input.experienceYears !== undefined) patch.experience_years = input.experienceYears;
  // Phase 1.3 profile fields - jsonb columns stringified on write, like specialties above.
  if (input.bio !== undefined) patch.bio = input.bio;
  if (input.languages !== undefined) patch.languages = JSON.stringify(input.languages);
  if (input.education !== undefined) patch.education = JSON.stringify(input.education);
  if (input.awards !== undefined) patch.awards = JSON.stringify(input.awards);
  if (input.socialLinks !== undefined) patch.social_links = JSON.stringify(input.socialLinks);
  if (input.featuredServiceIds !== undefined) patch.featured_service_ids = JSON.stringify(input.featuredServiceIds);
  if (input.status !== undefined) {
    patch.status = input.status;
    if (input.status !== "active") patch.left_at = new Date();
  }

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(400, "No fields to update");
  }

  return businessMemberRepo.update(memberId, patch);
};

/**
 * Phase 1.3c - a professional edits their OWN profile. memberId is the caller's
 * own membership (resolved by resolveOwnMembership), and the schema restricts
 * input to self-editable fields, so this can never change role/permissions/
 * designation/experience/featured services.
 */
export const updateOwnProfile = async (studioId, memberId, input) => {
  const patch = {};
  if (input.bio !== undefined) patch.bio = input.bio;
  if (input.languages !== undefined) patch.languages = JSON.stringify(input.languages);
  if (input.education !== undefined) patch.education = JSON.stringify(input.education);
  if (input.awards !== undefined) patch.awards = JSON.stringify(input.awards);
  if (input.socialLinks !== undefined) patch.social_links = JSON.stringify(input.socialLinks);

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(400, "No fields to update");
  }

  return businessMemberRepo.update(memberId, patch);
};

export const removeMember = async (studioId, memberId) => {
  const member = await businessMemberRepo.findByIdForStudio(memberId, studioId);
  if (!member) throw new ServiceError(404, "Team member not found");

  await assertNotLastOwner(studioId, member);

  await businessMemberRepo.softRemove(memberId);
};
