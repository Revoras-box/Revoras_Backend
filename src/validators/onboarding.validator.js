import { z } from "zod";
import { updateBusinessSchema } from "./business.validator.js";

// Phase 1.5a - onboarding step save. `data` reuses the existing business update
// schema (partial), so Basics/Information field validation isn't duplicated.
// `step` is the resume cursor.
export const saveStepSchema = z.object({
  step: z.coerce.number().int().min(0).max(8).optional(),
  data: updateBusinessSchema.optional(),
});
