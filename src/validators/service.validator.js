import { z } from "zod";

const serviceFields = {
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  categoryId: z.string().uuid(),
  price: z.number().positive().max(1000000),
  duration: z.number().int().positive().max(1440),
  imageUrl: z.string().url().max(500).optional(),
  isActive: z.boolean().default(true),
};

export const createServiceSchema = z.object(serviceFields);

export const updateServiceSchema = z.object(serviceFields).partial();

export const listServicesQuerySchema = z.object({
  activeOnly: z.coerce.boolean().default(false),
});
