import express from "express";
import {
  getProfile,
  updateProfile,
  updateNotifications,
  addFavorite,
  removeFavorite,
  getFavorites,
  deleteAccount
} from "../controller/profile.controller.js";
import { authenticateToken, requireUser } from "../middlewares/auth.middleware.js";
import { apiLimiter, strictLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

// All profile routes require authentication
router.use(authenticateToken);
router.use(requireUser);

// Profile CRUD
router.get("/", apiLimiter, getProfile);
router.put("/", strictLimiter, updateProfile);
router.delete("/", strictLimiter, deleteAccount);

// Notification preferences
router.put("/notifications", strictLimiter, updateNotifications);

// Favorites
router.get("/favorites", apiLimiter, getFavorites);
router.post("/favorites/:studioId", strictLimiter, addFavorite);
router.delete("/favorites/:studioId", strictLimiter, removeFavorite);

export default router;
