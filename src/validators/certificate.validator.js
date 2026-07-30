import { z } from "zod";
import { httpUrl } from "./url.validator.js";

const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected date as YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date");

const certificateFields = {
  title: z.string().min(1).max(200),
  issuer: z.string().min(1).max(200),
  issuedDate: dateStr.nullable().optional(),
  expiryDate: dateStr.nullable().optional(),
  credentialId: z.string().max(200).nullable().optional(),
  verificationUrl: httpUrl.nullable().optional(),
};

// expiry must not precede issue date when both are given.
const notExpiredBeforeIssued = (data) =>
  !data.issuedDate || !data.expiryDate || Date.parse(data.expiryDate) >= Date.parse(data.issuedDate);

export const createCertificateSchema = z
  .object(certificateFields)
  .refine(notExpiredBeforeIssued, { message: "expiryDate cannot be before issuedDate", path: ["expiryDate"] });

export const updateCertificateSchema = z
  .object(certificateFields)
  .partial()
  .refine(notExpiredBeforeIssued, { message: "expiryDate cannot be before issuedDate", path: ["expiryDate"] });
