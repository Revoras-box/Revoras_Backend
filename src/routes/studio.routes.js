import express from "express";
import {
  getStudios,
  getStudioById,
  getStudioServices,
  getStudioBarbers,
  getStudiosForMap
} from "../controller/studio.controller.js";
import { apiLimiter } from "../middlewares/rateLimit.middleware.js";
import { optionalAuth } from "../middlewares/auth.middleware.js";

const router = express.Router();

// All studio routes are public but may benefit from optional auth
router.use(optionalAuth);
router.use(apiLimiter);

// Get studios for map display (optimized endpoint)
router.get("/map", getStudiosForMap);

// Get all studios with filtering
router.get("/", getStudios);

// Get studio details
router.get("/:id", getStudioById);

// Get studio services
router.get("/:id/services", getStudioServices);

// Get studio barbers
router.get("/:id/barbers", getStudioBarbers);

export default router;
