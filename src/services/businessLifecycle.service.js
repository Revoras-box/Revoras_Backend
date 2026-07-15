import * as businessRepo from "../repositories/business.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Phase 1.5a - BusinessLifecycleService: the SINGLE authority for a business's
 * lifecycle state (design + decisions: docs/business-lifecycle-state-machine.md).
 * Every subsystem - Discovery, Booking, Payments, Verification, Admin - asks
 * this service instead of re-implementing state logic. It is the only writer of
 * `business_status`.
 *
 * Migration bridge (1.5a..1.5f): `business_status` is authoritative; this
 * service also mirrors the legacy `approval_status`/`is_active` columns so
 * not-yet-migrated admin readers keep working. The mirror is dropped in 1.5f.
 */

export const STATUS = Object.freeze({
  DRAFT: "draft",
  ONBOARDING: "onboarding",
  PAYMENT_PENDING: "payment_pending",
  PENDING_REVIEW: "pending_review",
  UNDER_REVIEW: "under_review",
  APPROVED: "approved",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REJECTED: "rejected",
});

const TRANSITIONS = Object.freeze({
  draft: ["onboarding", "pending_review"],
  onboarding: ["payment_pending", "draft"],
  payment_pending: ["pending_review"],
  pending_review: ["under_review", "approved", "rejected"],
  under_review: ["approved", "rejected", "pending_review"],
  approved: ["active", "suspended", "rejected"],
  active: ["suspended"],
  suspended: ["active", "rejected"],
  rejected: ["onboarding", "draft"],
});

export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;

// ---- predicates every other subsystem should consult ----

export const canAppearInDiscovery = (status) => status === STATUS.ACTIVE;
export const canAcceptBookings = (status) => status === STATUS.ACTIVE;
// Onboarding/subscription payments are allowed while paying to enter review;
// booking payments only once active.
export const canReceivePayments = (status) => status === STATUS.PAYMENT_PENDING || status === STATUS.ACTIVE;

// Legacy mirror for the migration bridge: derive (approval_status, is_active)
// from the canonical business_status.
const legacyMirror = (status) => {
  switch (status) {
    case STATUS.ACTIVE:
      return { approval_status: "approved", is_active: true };
    case STATUS.APPROVED:
      return { approval_status: "approved", is_active: false };
    case STATUS.REJECTED:
      return { approval_status: "rejected", is_active: false };
    case STATUS.SUSPENDED:
      return { approval_status: "suspended", is_active: false };
    default:
      // draft / onboarding / payment_pending / pending_review / under_review
      return { approval_status: "pending", is_active: false };
  }
};

/**
 * The only writer of business_status. Validates the edge, writes the canonical
 * column + the legacy mirror, and returns the updated status row. `extra` lets
 * a caller persist a decision reason etc. in the same update.
 */
export const transition = async (businessId, toStatus, { extra = {} } = {}) => {
  const current = await businessRepo.findStatus(businessId);
  if (!current) throw new ServiceError(404, "Business not found");

  if (current.business_status === toStatus) return current; // idempotent no-op
  if (!canTransition(current.business_status, toStatus)) {
    throw new ServiceError(409, `Cannot move a '${current.business_status}' business to '${toStatus}'`);
  }

  return businessRepo.updateStatus(businessId, {
    business_status: toStatus,
    ...legacyMirror(toStatus),
    ...extra,
  });
};

/**
 * The four conditions that gate ACTIVE (O1). `paymentDone`/`subscriptionActive`
 * are now real (Phase 1.5d - businessSubscription.service.js). `onboardingComplete`
 * still defaults to satisfied - the wizard (1.5b) doesn't yet block on this
 * predicate, so tightening it is deferred without changing today's behaviour.
 * businessSubscription.service.js is imported dynamically here (not statically)
 * because it imports this file back (for STATUS/getStatus/transition/
 * canReceivePayments) - the deferred import breaks the require cycle, same
 * idiom auth.service.js uses for business.service.js.
 */
export const activationConditions = async (businessId) => {
  const current = await businessRepo.findStatus(businessId);
  if (!current) throw new ServiceError(404, "Business not found");

  const { getState } = await import("./businessSubscription.service.js");
  const subscription = await getState(businessId);

  return {
    onboardingComplete: true, // TODO(1.5b): derive from wizard completion
    paymentDone: subscription.history.some((h) => h.status === "active"),
    subscriptionActive: subscription.active,
    adminApproved: current.business_status === STATUS.APPROVED || current.business_status === STATUS.ACTIVE,
  };
};

/**
 * Move an APPROVED business to ACTIVE iff every activation condition holds.
 * Returns the (possibly unchanged) status row plus the evaluated conditions so
 * the caller can tell the owner what is still missing.
 */
export const activateBusiness = async (businessId) => {
  const conditions = await activationConditions(businessId);
  const ready = Object.values(conditions).every(Boolean);
  if (!ready) {
    const current = await businessRepo.findStatus(businessId);
    return { activated: false, conditions, status: current.business_status };
  }
  const row = await transition(businessId, STATUS.ACTIVE);
  return { activated: true, conditions, status: row.business_status };
};

export const suspendBusiness = (businessId, { reason } = {}) =>
  transition(businessId, STATUS.SUSPENDED, { extra: reason ? { admin_notes: reason } : {} });

export const getStatus = async (businessId) => {
  const row = await businessRepo.findStatus(businessId);
  return row?.business_status ?? null;
};
