import { z } from "zod";

/**
 * One row of the owner's "services this professional performs" form.
 *
 * `duration` is required whenever the row is ticked - it's the whole point of
 * the screen, and the number the scheduling interval is derived from. `price`
 * stays optional and nullable: null (or absent) means "charge the catalogue
 * price", so a shop that prices uniformly never has to restate it per employee.
 */
const assignmentSchema = z
  .object({
    serviceId: z.string().uuid(),
    enabled: z.boolean(),
    // Same ceiling as the catalogue's own duration - a service longer than a
    // day can't be scheduled against any shift.
    duration: z.number().int().positive().max(1440).optional(),
    price: z.number().nonnegative().max(1000000).nullable().optional(),
  })
  .refine((row) => !row.enabled || row.duration !== undefined, {
    message: "Duration is required for every service this professional performs",
    path: ["duration"],
  });

export const setMemberServicesSchema = z.object({
  services: z.array(assignmentSchema),
});
