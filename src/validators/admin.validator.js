import { z } from "zod";
import { passwordField, anyPasswordField } from "./password.policy.js";

export const adminLoginSchema = z.object({
  email: z.string().email(),
  password: anyPasswordField,
});

export const createAdminSchema = z.object({
  name: z.string().min(1).max(255),
  email: z.string().email(),
  // Admin accounts have the largest blast radius on the platform, so they get
  // at least the same policy as everyone else - not the weaker rule they had.
  password: passwordField,
  role: z.enum(["admin", "super_admin"]).default("admin"),
});
