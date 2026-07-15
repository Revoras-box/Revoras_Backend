import { z } from "zod";

const roleKey = z.enum(["owner", "staff"]);
const status = z.enum(["active", "inactive", "suspended"]);

export const addMemberSchema = z.object({
  email: z.string().email(),
  roleKey,
  designation: z.string().max(100).optional(),
  providesServices: z.boolean().default(true),
  specialties: z.array(z.string()).default([]),
  experienceYears: z.number().int().min(0).max(80).default(0),
});

// Phase 1.3 - Professional Profile Enhancement. Structured list items keep only
// the display-critical field required, so a half-filled dashboard entry still saves.
const educationItem = z.object({
  institution: z.string().min(1).max(200),
  degree: z.string().max(200).optional(),
  year: z.string().max(10).optional(),
});
const awardItem = z.object({
  title: z.string().min(1).max(200),
  year: z.string().max(10).optional(),
});
const memberSocialLinks = z
  .object({
    instagram: z.string().max(500),
    facebook: z.string().max(500),
    twitter: z.string().max(500),
    youtube: z.string().max(500),
    tiktok: z.string().max(500),
    linkedin: z.string().max(500),
    website: z.string().max(500),
  })
  .partial();

export const updateMemberSchema = z
  .object({
    roleKey: roleKey.optional(),
    designation: z.string().max(100).nullable().optional(),
    providesServices: z.boolean().optional(),
    specialties: z.array(z.string()).optional(),
    experienceYears: z.number().int().min(0).max(80).optional(),
    status,
    // Phase 1.3 profile fields
    bio: z.string().max(5000).nullable().optional(),
    languages: z.array(z.string().max(100)).max(50).optional(),
    education: z.array(educationItem).max(50).optional(),
    awards: z.array(awardItem).max(50).optional(),
    socialLinks: memberSocialLinks.optional(),
    featuredServiceIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .partial();

// Phase 1.3c - self-service subset. A professional editing their own profile
// may only touch these fields; everything business-controlled (role, permissions,
// designation, experience, featured services, status) is deliberately excluded.
export const updateOwnProfileSchema = z
  .object({
    bio: z.string().max(5000).nullable().optional(),
    languages: z.array(z.string().max(100)).max(50).optional(),
    education: z.array(educationItem).max(50).optional(),
    awards: z.array(awardItem).max(50).optional(),
    socialLinks: memberSocialLinks.optional(),
  })
  .partial();
