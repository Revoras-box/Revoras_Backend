import bcrypt from "bcrypt";
import { BCRYPT_ROUNDS } from "../config/hashing.js";
import jwt from "jsonwebtoken";
import { JWT_ALGORITHM } from "../config/jwt.js";
import * as adminRepo from "../repositories/admin.repository.js";
import * as adminActivityLogService from "./adminActivityLog.service.js";
import { ServiceError } from "../utils/ServiceError.js";

const TOKEN_EXPIRY = "12h";

/**
 * `admins` is a deliberately separate identity from `users` - report.md
 * §2.0/Phase 2.5 plan's "keep Admin isolated from the Business permission
 * model." Token shape (`{id, role}`) and the simple admin/super_admin role
 * check are unchanged from Phase 2.3 (which left this alone on purpose).
 */
export const login = async ({ email, password }, ipAddress) => {
  if (!email || !password) throw new ServiceError(400, "Email and password required");

  const admin = await adminRepo.findByEmail(email);
  if (!admin) throw new ServiceError(401, "Invalid credentials");

  const valid = await bcrypt.compare(password, admin.password);
  if (!valid) throw new ServiceError(401, "Invalid credentials");

  if (!admin.is_active) throw new ServiceError(403, "Account is deactivated");

  await adminRepo.updateLastLogin(admin.id);

  const token = jwt.sign({ id: admin.id, role: admin.role }, process.env.JWT_SECRET, { algorithm: JWT_ALGORITHM, expiresIn: TOKEN_EXPIRY });

  await adminActivityLogService.log(admin.id, "login", "admin", admin.id, {}, ipAddress);

  return { token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } };
};

export const getProfile = async (adminId) => {
  const admin = await adminRepo.findProfileById(adminId);
  if (!admin) throw new ServiceError(404, "Admin not found");
  return admin;
};

const assertSuperAdmin = (role) => {
  if (role !== "super_admin") throw new ServiceError(403, "Super admin access required");
};

export const createAdmin = async (creatorRole, creatorId, input, ipAddress) => {
  assertSuperAdmin(creatorRole);

  const existing = await adminRepo.findByEmail(input.email);
  if (existing) throw new ServiceError(409, "Email already registered");

  const hashed = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const admin = await adminRepo.create({ name: input.name, email: input.email, password: hashed, role: input.role || "admin" });

  await adminActivityLogService.log(
    creatorId,
    "create_admin",
    "admin",
    admin.id,
    { name: input.name, email: input.email, role: input.role || "admin" },
    ipAddress
  );

  return admin;
};

export const listAdmins = (creatorRole) => {
  assertSuperAdmin(creatorRole);
  return adminRepo.listAll();
};
