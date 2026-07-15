import { z } from "zod";

// Phase 2.4 (Offers & Promotions).
//
// Cross-field rules (percentage range, service list required when scoped,
// start-before-end) are enforced with .superRefine so the error is on the
// offending field, not a generic 400 - the dashboard form maps these back to
// fields. discount_value's meaning depends on discount_type, so it can't be
// range-checked on its own; that check lives in the refine.

const offerBase = {
  title: z.string().min(1).max(150),
  description: z.string().max(500).optional().nullable(),
  discountType: z.enum(["flat", "percentage"]),
  discountValue: z.coerce.number().positive(),
  maxDiscountAmount: z.coerce.number().positive().optional().nullable(),
  minSpend: z.coerce.number().nonnegative().optional().nullable(),
  appliesTo: z.enum(["business", "services"]).default("business"),
  serviceIds: z.array(z.string().uuid()).optional(),
  startAt: z.coerce.date().optional().nullable(),
  endAt: z.coerce.date().optional().nullable(),
  isActive: z.boolean().optional(),
  maxUses: z.coerce.number().int().positive().optional().nullable(),
  maxUsesPerUser: z.coerce.number().int().positive().optional().nullable(),
  firstTimeOnly: z.boolean().optional(),
};

const refineOffer = (data, ctx) => {
  if (data.discountType === "percentage" && data.discountValue != null && data.discountValue > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discountValue"], message: "A percentage discount cannot exceed 100%" });
  }
  if (data.appliesTo === "services" && (!data.serviceIds || data.serviceIds.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["serviceIds"], message: "Select at least one service for a service-specific offer" });
  }
  if (data.startAt && data.endAt && data.startAt >= data.endAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endAt"], message: "End date must be after the start date" });
  }
  if (data.maxDiscountAmount != null && data.discountType === "flat") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxDiscountAmount"], message: "A discount cap only applies to percentage offers" });
  }
};

export const createOfferSchema = z.object(offerBase).superRefine(refineOffer);

// On update every field is optional, but the cross-field rules still hold when
// the relevant pair is present. partial() first, then the same refine.
export const updateOfferSchema = z.object(offerBase).partial().superRefine(refineOffer);
