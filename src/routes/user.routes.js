import express from "express";
import { customerRegister, customerLogin } from "../controllers/auth.controller.js";
import { authLimiter, authFloodLimiter, registerLimiter } from "../middlewares/rateLimit.middleware.js";

const router = express.Router();

router.post("/signup", authFloodLimiter, registerLimiter, customerRegister);
router.post("/login", authFloodLimiter, authLimiter, customerLogin);

export default router;
