import { z } from "zod";

/**
 * Phase 4A. Both schemas are deliberately tight: every field here becomes an
 * outbound request to a third-party service we're rate-limited against, so
 * junk input should be rejected here rather than spending a slot in the
 * provider's 1 req/sec queue.
 */

export const forwardGeocodeQuerySchema = z.object({
  // Two characters is the shortest query worth spending a request on - a
  // single letter matches half a country and the picker list would be noise.
  q: z.string().trim().min(2, "Enter at least 2 characters").max(200),
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

export const reverseGeocodeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
