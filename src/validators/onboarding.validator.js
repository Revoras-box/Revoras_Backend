import { z } from "zod";
import { updateBusinessSchema } from "./business.validator.js";

// Phase 1.5a - onboarding step save. `data` reuses the existing business update
// schema (partial), so Basics/Information field validation isn't duplicated.
// `step` is the resume cursor.
export const saveStepSchema = z.object({
  // Resume cursor: a step index into onboarding.service.js's STEP_DEFS, which
  // has 10 entries (0..9). This was .max(8) and silently broke the moment the
  // Location step (Phase 4A) made Subscription index 9 - advancing off Review
  // (8) to Subscription (9) then 400'd with "Validation failed". Keep this in
  // step with STEP_DEFS.length - 1.
  step: z.coerce.number().int().min(0).max(9).optional(),
  data: updateBusinessSchema.optional(),
});
