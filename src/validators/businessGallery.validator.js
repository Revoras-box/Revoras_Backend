import { z } from "zod";

export const reorderGallerySchema = z.object({
  orderedImageIds: z.array(z.string().uuid()).min(1),
});
