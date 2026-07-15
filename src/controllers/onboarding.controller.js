import * as onboardingService from "../services/onboarding.service.js";
import { saveStepSchema } from "../validators/onboarding.validator.js";

// Phase 1.5a - onboarding wizard. Mounted under /api/business/:studioId, so the
// caller is an authorized member of the business. Reads member-only; writes
// require settings.manage (see route wiring).

// GET /api/business/:studioId/onboarding
export const getOnboarding = async (req, res) => {
  const state = await onboardingService.getState(req.params.studioId);
  res.json(state);
};

// PATCH /api/business/:studioId/onboarding
export const saveOnboardingStep = async (req, res) => {
  const input = saveStepSchema.parse(req.body);
  const state = await onboardingService.saveStep(req.params.studioId, input);
  res.json({ message: "Progress saved", ...state });
};

// POST /api/business/:studioId/onboarding/submit
export const submitOnboarding = async (req, res) => {
  const result = await onboardingService.submitOnboarding(req.params.studioId);
  res.json({ message: "Submitted for review", ...result });
};
