import express from "express";
import { customerRegister, customerLogin } from "../controllers/auth.controller.js";
import { authLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/signup", authLimiter, customerRegister);
router.post("/login", authLimiter, customerLogin);

export default router;
