import * as adminService from "../services/admin.service.js";
import { adminLoginSchema, createAdminSchema } from "../validators/admin.validator.js";

// POST /api/admin/login
export const adminLogin = async (req, res) => {
  const input = adminLoginSchema.parse(req.body);
  const result = await adminService.login(input, req.ip);
  res.json(result);
};

// GET /api/admin/me
export const getAdminProfile = async (req, res) => {
  const admin = await adminService.getProfile(req.user.id);
  res.json({ admin });
};

// POST /api/admin/admins (super_admin only)
export const createAdmin = async (req, res) => {
  const input = createAdminSchema.parse(req.body);
  const admin = await adminService.createAdmin(req.user.role, req.user.id, input, req.ip);
  res.status(201).json({ message: "Admin created successfully", admin });
};

// GET /api/admin/admins (super_admin only)
export const getAdmins = async (req, res) => {
  const admins = await adminService.listAdmins(req.user.role);
  res.json({ admins });
};
