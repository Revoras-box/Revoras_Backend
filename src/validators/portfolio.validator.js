import { z } from "zod";

export const reorderPortfolioSchema = z.object({
  orderedImageIds: z.array(z.string().uuid()).min(1),
});

// caption arrives as a multipart field on upload and as JSON on the caption
// endpoint; empty string clears it.
export const captionSchema = z.object({
  caption: z.string().max(500).optional(),
});
