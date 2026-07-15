import * as adminUserRepo from "../repositories/adminUser.repository.js";
import * as adminActivityLogService from "./adminActivityLog.service.js";
import { ServiceError } from "../utils/ServiceError.js";

export const list = async (query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;

  const { rows, total } = await adminUserRepo.listForAdmin({ search: query.search, page, limit });

  return { users: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

const setActive = async (id, isActive, adminId, ipAddress) => {
  const updated = await adminUserRepo.setActive(id, isActive);
  if (!updated) throw new ServiceError(404, "User not found");

  await adminActivityLogService.log(adminId, isActive ? "activate_user" : "suspend_user", "user", id, {}, ipAddress);

  return updated;
};

export const suspend = (id, adminId, ipAddress) => setActive(id, false, adminId, ipAddress);
export const activate = (id, adminId, ipAddress) => setActive(id, true, adminId, ipAddress);
