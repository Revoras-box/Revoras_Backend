import * as adminUserService from "../services/adminUser.service.js";
import { listUsersQuerySchema } from "../validators/adminUser.validator.js";

// GET /api/admin/users
export const listUsers = async (req, res) => {
  const query = listUsersQuerySchema.parse(req.query);
  const result = await adminUserService.list(query);
  res.json(result);
};

// PATCH /api/admin/users/:id/suspend
export const suspendUser = async (req, res) => {
  const user = await adminUserService.suspend(req.params.id, req.user.id, req.ip);
  res.json({ message: "User suspended", user });
};

// PATCH /api/admin/users/:id/activate
export const activateUser = async (req, res) => {
  const user = await adminUserService.activate(req.params.id, req.user.id, req.ip);
  res.json({ message: "User activated", user });
};
