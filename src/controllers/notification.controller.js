import * as notificationService from "../services/notification.service.js";
import { listNotificationsQuerySchema } from "../validators/notification.validator.js";

// GET /api/notifications
export const listNotifications = async (req, res) => {
  const query = listNotificationsQuerySchema.parse(req.query);
  const result = await notificationService.list(req.user.id, query);
  res.json(result);
};

// GET /api/notifications/unread-count
export const getUnreadCount = async (req, res) => {
  const count = await notificationService.unreadCount(req.user.id);
  res.json({ count });
};

// PATCH /api/notifications/:id/read
export const markRead = async (req, res) => {
  const notification = await notificationService.markRead(req.user.id, req.params.id);
  res.json({ notification });
};

// PATCH /api/notifications/read-all
export const markAllRead = async (req, res) => {
  await notificationService.markAllRead(req.user.id);
  res.json({ message: "All notifications marked as read" });
};
