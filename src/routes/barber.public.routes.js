import express from "express";
import { getBarberById } from "../controller/barber.controller.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";
import { optionalAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

router.use(optionalAuth);
router.use(apiLimiter);

// GET /api/barbers/:id — Public barber profile
router.get("/:id", getBarberById);

export default router;
