import { z } from "zod";

const passwordField = z.string().min(6).max(100);
const phoneField = z.string().min(7).max(20);

export const customerRegisterSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  phone: phoneField.optional(),
  password: passwordField,
});

export const loginSchema = z
  .object({
    email: z.string().email().optional(),
    phone: phoneField.optional(),
    password: z.string().min(1),
  })
  .refine((v) => v.email || v.phone, { message: "email or phone is required" });

export const businessRegisterSchema = z.object({
  ownerName: z.string().min(1).max(255),
  email: z.string().email(),
  phone: phoneField,
  password: passwordField,
  businessName: z.string().min(1).max(255),
  address: z.string().min(1).max(500),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
  designation: z.string().max(100).optional(),
  providesServices: z.boolean().default(true),
});

// Phase 1.5a - host signup: minimal fields to open the account + a DRAFT
// business. The rest of the business profile is collected by the onboarding
// wizard, not here.
export const hostRegisterSchema = z.object({
  ownerName: z.string().min(1).max(255),
  email: z.string().email(),
  phone: phoneField,
  password: passwordField,
  businessName: z.string().min(1).max(255),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordField,
});
