import { z } from "zod";

// Phase 1.4b - business-facing verification payloads. The uploaded file itself
// is validated by the upload middleware / MediaService; here we validate the
// surrounding fields.

export const createRequestSchema = z.object({
  applicantNote: z.string().max(1000).optional(),
});

export const addDocumentSchema = z.object({
  type: z.enum(["business_license", "id_proof", "address_proof", "tax_document", "other"]),
});
