import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  phone: z.string().min(7).max(20).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD").optional(),
  gender: z.string().max(20).optional(),
  avatarUrl: z.string().url().max(500).optional(),
  preferences: z.record(z.string(), z.unknown()).optional(),
});

export const notificationSettingsSchema = z.object({
  email: z.boolean().default(true),
  push: z.boolean().default(true),
  sms: z.boolean().default(false),
  marketing: z.boolean().default(false),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1),
});
