import express from "express";
import { listNotifications, getUnreadCount, markRead, markAllRead } from "../controllers/notification.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";

// New this phase (report.md Phase 2.4 plan) - real DB-persisted notifications,
// not the transient in-memory approach the brief explicitly ruled out.
const router = express.Router();

router.use(authenticate, apiLimiter);

router.get("/", listNotifications);
router.get("/unread-count", getUnreadCount);
router.patch("/read-all", markAllRead);
router.patch("/:id/read", markRead);

export default router;
