import * as businessRepo from "../repositories/business.repository.js";
import * as trustRepo from "../repositories/trust.repository.js";
import * as businessService from "./business.service.js";
import * as lifecycle from "./businessLifecycle.service.js";
import * as subscriptionService from "./businessSubscription.service.js";
import { ServiceError } from "../utils/ServiceError.js";

/**
 * Phase 1.5a - the onboarding wizard's backend. It does NOT re-implement any
 * business logic: Business Basics/Information write through business.service's
 * updateBusiness; services, gallery, hours and members are edited via their
 * existing /business/:studioId/* endpoints; status only ever changes through
 * BusinessLifecycleService. This service owns two genuinely new things -
 * computing wizard progress, and the submit transition.
 *
 * Documents (Step 7) is still a placeholder - built in 1.5c, surfaced but not
 * required to submit. Submit lands the business at PAYMENT_PENDING; the ₹99
 * Subscription (Step 9, Phase 1.5d - businessSubscription.service.js) is what
 * then moves it to PENDING_REVIEW.
 */

const STEP_DEFS = [
  { key: "basics", label: "Business basics", required: true },
  { key: "info", label: "Business information", required: false },
  { key: "services", label: "Services", required: true },
  { key: "professionals", label: "Professionals", required: false },
  { key: "gallery", label: "Gallery", required: true },
  { key: "hours", label: "Business hours", required: false },
  { key: "documents", label: "Verification documents", required: false, comingIn: "1.5c" },
  { key: "review", label: "Review", required: false },
  { key: "subscription", label: "Subscription (₹99)", required: false },
];

export const STEP_COUNT = STEP_DEFS.length;

const gatherCompletion = async (studioId, biz) => {
  const [services, gallery, staff, openHours, subscription] = await Promise.all([
    trustRepo.activeServiceCount(studioId),
    trustRepo.galleryCount(studioId),
    trustRepo.activeStaffCount(studioId),
    trustRepo.openHoursCount(studioId),
    subscriptionService.getState(studioId),
  ]);
  return {
    basics: Boolean(biz.name && biz.address && biz.category_id),
    info: Boolean(biz.description),
    services: services > 0,
    professionals: staff > 0,
    gallery: gallery > 0,
    hours: openHours > 0,
    documents: false, // 1.5c
    review: false,
    subscription: subscription.active,
  };
};

export const getState = async (studioId) => {
  const biz = await businessRepo.findById(studioId);
  if (!biz) throw new ServiceError(404, "Business not found");

  const complete = await gatherCompletion(studioId, biz);
  const steps = STEP_DEFS.map((s, i) => ({
    index: i,
    key: s.key,
    label: s.label,
    required: Boolean(s.required),
    complete: complete[s.key] ?? false,
    comingIn: s.comingIn,
  }));

  const requiredSteps = steps.filter((s) => s.required);
  const canSubmit = requiredSteps.every((s) => s.complete);
  const completedCount = steps.filter((s) => s.complete).length;

  return {
    businessStatus: biz.business_status,
    currentStep: biz.onboarding_step ?? 0,
    steps,
    completionPercent: Math.round((completedCount / STEP_DEFS.length) * 100),
    canSubmit,
    missing: requiredSteps.filter((s) => !s.complete).map((s) => s.label),
  };
};

/**
 * Persist one step's data (Business Basics/Information fields) and advance the
 * resume cursor. Starting to edit a DRAFT flips it to ONBOARDING via the
 * lifecycle service. Services/gallery/hours/documents are saved through their
 * own endpoints, not here - for those the wizard just moves the cursor.
 */
export const saveStep = async (studioId, { step, data } = {}) => {
  const status = await businessRepo.findStatus(studioId);
  if (!status) throw new ServiceError(404, "Business not found");

  if (status.business_status === lifecycle.STATUS.DRAFT) {
    await lifecycle.transition(studioId, lifecycle.STATUS.ONBOARDING);
  }

  if (data && Object.keys(data).length > 0) {
    await businessService.updateBusiness(studioId, data);
  }
  if (typeof step === "number") {
    await businessRepo.update(studioId, { onboarding_step: Math.max(0, Math.min(STEP_DEFS.length - 1, step)) });
  }

  return getState(studioId);
};

/**
 * Submit the completed onboarding for review. Requires every required step
 * complete, then transitions to PAYMENT_PENDING (the ₹99 gate, wired in 1.5d).
 * The business remains invisible in discovery throughout - only ACTIVE shows.
 */
export const submitOnboarding = async (studioId) => {
  const state = await getState(studioId);
  if (!state.canSubmit) {
    throw new ServiceError(400, `Complete required steps before submitting: ${state.missing.join(", ")}`);
  }

  const current = await lifecycle.getStatus(studioId);
  if (current === lifecycle.STATUS.PAYMENT_PENDING) return { businessStatus: current };
  if (current === lifecycle.STATUS.DRAFT) await lifecycle.transition(studioId, lifecycle.STATUS.ONBOARDING);

  const row = await lifecycle.transition(studioId, lifecycle.STATUS.PAYMENT_PENDING);
  return { businessStatus: row.business_status };
};
