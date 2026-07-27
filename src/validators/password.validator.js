import { z } from "zod";
import { passwordField } from "./password.policy.js";

export const forgotPasswordSchema = z.object({ email: z.string().email() });

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: passwordField,
});
