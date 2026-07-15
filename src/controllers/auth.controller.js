import * as authService from "../services/auth.service.js";
import { customerRegisterSchema, loginSchema, businessRegisterSchema, hostRegisterSchema, changePasswordSchema } from "../validators/auth.validator.js";

// POST /api/users/signup
export const customerRegister = async (req, res) => {
  const input = customerRegisterSchema.parse(req.body);
  const result = await authService.customerRegister(input);
  res.status(201).json(result);
};

// POST /api/users/login
export const customerLogin = async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await authService.customerLogin(input);
  res.json(result);
};

// POST /api/auth/business/register
export const businessRegister = async (req, res) => {
  const input = businessRegisterSchema.parse(req.body);
  const result = await authService.businessRegister(input);
  res.status(201).json(result);
};

// POST /api/auth/host/register - Phase 1.5a host signup (creates a DRAFT business)
export const hostRegister = async (req, res) => {
  const input = hostRegisterSchema.parse(req.body);
  const result = await authService.hostRegister(input);
  res.status(201).json(result);
};

// POST /api/auth/business/login
// Owners and staff share this one endpoint (report.md Phase 2.3 plan) -
// response includes every active business membership + effective
// permissions so the frontend can pick/display the right dashboard.
export const businessLogin = async (req, res) => {
  const input = loginSchema.parse(req.body);
  const result = await authService.businessLogin(input);
  res.json(result);
};

// GET /api/auth/me
export const me = async (req, res) => {
  const result = await authService.me(req.user.id);
  res.json(result);
};

// POST /api/auth/change-password
export const changePassword = async (req, res) => {
  const input = changePasswordSchema.parse(req.body);
  await authService.changePassword(req.user.id, input);
  res.json({ message: "Password changed successfully" });
};
