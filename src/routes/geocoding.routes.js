import express from "express";
import { forwardGeocode, reverseGeocode } from "../controllers/geocoding.controller.js";
import { authenticate } from "../middlewares/authenticate.middleware.js";
import { floodLimiter, strictLimiter } from "../middlewares/rateLimit.middleware.js";

/**
 * Phase 4A. Server-side proxy in front of the active GeocodingProvider - see
 * geocoding.service.js for why this can't be a direct browser call.
 *
 * Authenticated on purpose, even though addresses aren't sensitive. These
 * endpoints spend a shared, deployment-wide third-party budget (Nominatim
 * allows us one request per second in total), so leaving them open would let
 * anonymous traffic starve the owners actually trying to finish onboarding.
 * Requiring a JWT also makes `apiLimiter`-style per-user accounting possible
 * instead of per-IP guessing.
 *
 * strictLimiter (20/min per user) rather than apiLimiter (100/min): a human
 * typing into an address box, debounced, does not approach 20 - anything that
 * does is a runaway client, and every one of those requests costs a slot in a
 * queue the whole deployment shares.
 */
const router = express.Router();

router.use(floodLimiter, authenticate, strictLimiter);

router.get("/search", forwardGeocode);
router.get("/reverse", reverseGeocode);

export default router;
