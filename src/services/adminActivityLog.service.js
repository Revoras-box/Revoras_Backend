import * as adminActivityLogRepo from "../repositories/adminActivityLog.repository.js";
import { logger } from "../utils/logger.js";

/**
 * Audit logging must never block the admin action it's recording - matches
 * the original admin.controller.js's behavior (swallow and log, don't
 * throw). A failed audit write is a problem to notice, not a reason to fail
 * an approval/suspension that otherwise succeeded.
 */
export const log = async (adminId, action, entityType, entityId, details, ipAddress) => {
  try {
    await adminActivityLogRepo.create({
      admin_id: adminId,
      action,
      entity_type: entityType,
      entity_id: entityId || null,
      details: JSON.stringify(details || {}),
      ip_address: ipAddress || null,
    });
  } catch (err) {
    logger.error("Failed to write admin activity log", err);
  }
};

export const list = async (query) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 20;

  const { rows, total } = await adminActivityLogRepo.list({
    adminId: query.adminId,
    action: query.action,
    entityType: query.entityType,
    entityId: query.entityId,
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
    page,
    limit,
  });

  return { activity: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};
