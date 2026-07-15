import { z } from "zod";

export const listCategoriesQuerySchema = z.object({
  type: z.enum(["business", "service"]).optional(),
});
