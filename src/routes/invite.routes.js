import express from "express";
import { previewInvite, acceptInvite } from "../controllers/businessInvite.controller.js";
import { authLimiter, floodLimiter } from "../middlewares/rateLimit.middleware.js";

/**
 * Public counterpart to /api/business/:studioId/invites. Deliberately not on the
 * business router: the person holding the link has no account and no membership,
 * so requireBusinessMember could never pass. The bearer token in the URL is the
 * only credential, which is why accept is behind authLimiter - it can create a
 * user account, so it is an auth endpoint in everything but name.
 */
const router = express.Router();

router.get("/:token", floodLimiter, previewInvite);
router.post("/:token/accept", authLimiter, acceptInvite);

export default router;
