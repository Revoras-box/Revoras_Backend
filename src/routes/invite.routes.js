import express from "express";
import { previewInvite, acceptInvite } from "../controllers/businessInvite.controller.js";
import { authLimiter, authFloodLimiter, floodLimiter } from "../middlewares/rateLimit.middleware.js";

/**
 * Public counterpart to /api/business/:studioId/invites. Deliberately not on the
 * business router: the person holding the link has no account and no membership,
 * so requireBusinessMember could never pass. The bearer token in the URL is the
 * only credential, which is why accept is behind the auth limiters - it can
 * create a user account, so it is an auth endpoint in everything but name.
 * Having no email in the body, it keys per invite token, so guessing at one
 * link cannot lock out anyone else's.
 */
const router = express.Router();

router.get("/:token", floodLimiter, previewInvite);
router.post("/:token/accept", authFloodLimiter, authLimiter, acceptInvite);

export default router;
