import express from "express";
import { forgotPassword, resetPassword } from "../controller/password.controller.js";

const router = express.Router();

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

export default router;
