import express from "express";
import { listCategories } from "../controllers/category.controller.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";

// Public read - customers browse these too (report.md Phase 2.2 plan), no auth required.
const router = express.Router();

router.use(apiLimiter);

router.get("/", listCategories);

export default router;
