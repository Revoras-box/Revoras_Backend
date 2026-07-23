import { z } from "zod";

/**
 * Either an email or a phone is required, not both - see the migration for why
 * phone-only invites have to work. The refine carries that rule rather than
 * marking both optional and letting the service discover an empty invite.
 */
export const createInviteSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(255).optional(),
    // Indian mobile numbers, with or without +91 / 0 prefix and separators.
    phone: z
      .string()
      .trim()
      .regex(/^(\+?91[\s-]?)?[0]?[6-9]\d{9}$/, "Enter a valid Indian mobile number")
      .optional(),
    roleKey: z.enum(["owner", "staff"]).default("staff"),
    designation: z.string().trim().max(100).optional(),
    providesServices: z.boolean().default(true),
    experienceYears: z.number().int().min(0).max(70).default(0),
  })
  .refine((v) => !!v.email || !!v.phone, {
    message: "Add an email or a phone number so they can be reached",
    path: ["email"],
  });

export const acceptInviteSchema = z.object({
  // Absent when the invitee already has an account - they sign in instead.
  password: z.string().min(8).max(128).optional(),
  // Only sent for phone-only invites, which carry no email of their own.
  email: z.string().trim().email().max(255).optional(),
});
