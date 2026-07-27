import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import helmet from "helmet";

// NOTE: the old `app.use("/uploads", express.static(...))` mount was removed.
// Nothing has written to that directory since uploads moved to R2 (see
// services/media.service.js) - it served an empty folder, and a static file
// mount on the API's own origin is exactly where an uploaded file would need
// to land to turn a file upload into stored XSS. Removed rather than left as
// dormant surface.

import userRoutes from "./routes/user.routes.js";
import authRoutes from "./routes/auth.routes.js";
import verificationRoutes from "./routes/verification.routes.js";
import googleRoutes from "./routes/google.routes.js";
import passwordRoutes from "./routes/password.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import discoveryRoutes from "./routes/discovery.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import inviteRoutes from "./routes/invite.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import notificationRoutes from "./routes/notification.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import paymentRoutes from "./routes/payment.routes.js";
import businessOperationsRoutes from "./routes/businessOperations.routes.js";
import meRoutes from "./routes/me.routes.js";
import businessRoutes from "./routes/business.routes.js";
import categoryRoutes from "./routes/category.routes.js";
import geocodingRoutes from "./routes/geocoding.routes.js";
import { requestLogger } from "./middlewares/requestLogger.middleware.js";
import { errorHandler } from "./middlewares/errorHandler.middleware.js";
import { logger } from "./utils/logger.js";
import { assertStrongSecrets } from "./config/secrets.js";
import { assertPaymentModeIsSafe } from "./config/payments.js";
import passport from "passport";
import knex from "../db/knex.js";
dotenv.config({ quiet: true });

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required");
}
if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
// "Set" is not the same as "strong" - a guessable JWT_SECRET is a full
// platform compromise. See config/secrets.js.
assertStrongSecrets();
// Refuses a production boot that would confirm bookings without taking money.
assertPaymentModeIsSafe();

const isProduction = process.env.NODE_ENV === "production";

const app = express();

/**
 * Every per-IP rate limiter (floodLimiter, authFloodLimiter, registerLimiter)
 * keys off req.ip, so this setting decides whether those limiters work at all.
 *
 * Left at its default (0/false) behind a load balancer, req.ip is the
 * balancer's own address: the entire internet shares one bucket, which both
 * locks out real users and means an attacker's traffic is indistinguishable
 * from everyone else's. Set too permissively (`true`), Express believes the
 * left-most X-Forwarded-For entry, which the client itself controls - an
 * attacker just rotates a header value and the limiters never fire.
 *
 * So it must be the exact number of proxies you actually run. Configured, not
 * guessed.
 */
const trustProxy = Number(process.env.TRUST_PROXY);
app.set("trust proxy", Number.isFinite(trustProxy) && trustProxy > 0 ? trustProxy : false);
if (isProduction && !(trustProxy > 0)) {
  logger.warn(
    "TRUST_PROXY is 0 in production - if anything (nginx, a load balancer, Cloudflare) sits in front of this app, " +
      "req.ip is that proxy's address and all per-IP rate limiting is effectively disabled."
  );
}

app.use(helmet());

/**
 * CORS is an allowlist, never a fallback. Two changes from the original
 * single-origin version: several origins may be listed (an apex domain and its
 * www host are different origins to a browser), and there is no localhost
 * default in production - an unset FRONTEND_URL there is a misconfiguration
 * that should stop the deploy, not silently trust a development origin on a
 * credentialed API.
 */
const allowedOrigins = (process.env.FRONTEND_URL || (isProduction ? "" : "http://localhost:3000"))
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

if (allowedOrigins.length === 0) {
  throw new Error("FRONTEND_URL environment variable is required (comma-separate to allow several origins)");
}

app.use(
  cors({
    origin: (origin, callback) => {
      // No Origin header at all = a same-origin or non-browser caller (curl,
      // the Razorpay webhook, a health check). CORS is a browser control; it
      // has nothing to say about those, and rejecting them here would break
      // server-to-server traffic without adding any protection.
      if (!origin) return callback(null, true);
      callback(null, allowedOrigins.includes(origin.replace(/\/+$/, "")));
    },
    credentials: true,
  })
);

app.use(requestLogger);
app.use(
  express.json({
    // Explicit rather than relying on body-parser's 100kb default: this API's
    // largest payloads are onboarding forms, and an unbounded (or silently
    // defaulted) limit is the cheapest denial-of-service there is. File
    // uploads do not pass through here - they are multipart, handled by
    // upload.middleware.js with its own MEDIA_MAX_FILE_SIZE_MB cap.
    limit: "256kb",
    // Keeps the exact bytes Razorpay signed available as req.rawBody, needed to verify
    // the webhook's x-razorpay-signature header (see payment.controller.js).
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
// `extended: false` - this API has no nested form payloads (everything real is
// JSON), and the qs parser behind `extended: true` is the one with a history of
// prototype-pollution and resource-exhaustion advisories.
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // The session cookie exists only for the Google OAuth handshake; no API
    // endpoint authenticates from it. Locked down anyway so that stays true by
    // construction rather than by convention: unreadable to scripts (httpOnly),
    // not attached to cross-site requests (sameSite), HTTPS-only in production.
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction,
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

import "./config/passport.js";
app.use(passport.initialize());
app.use(passport.session());

// User routes (customer register/login - same path as before, new
// implementation underneath, see auth.controller.js)
app.use("/api/users", userRoutes);

// Phase 2.3 (report.md Phase 2 plan): unified business register/login +
// me/change-password. Replaces the old studio.auth.controller.js (owner) +
// barber.controller.js (staff) split entirely. /api/studios/manage/* (old
// dashboard/services/team/analytics/settings/time-off/signup/login, plus
// the out-of-scope bookings-list/walk-in/reviews/payments Phase 2.2 left
// behind) is gone - its only gate, requireStudioAccess, is retired this
// phase, and every handler behind it was already 100% broken (old table
// names) regardless of auth. Booking/team/service/dashboard functionality
// lives at /api/bookings and /api/business/:studioId/* instead.
app.use("/api/auth", authRoutes);

// Admin routes
app.use("/api/admin", adminRoutes);

// Other routes
app.use("/api/verification", verificationRoutes);
app.use("/api/auth/google", googleRoutes);
app.use("/api/password", passwordRoutes);
app.use("/api/bookings", bookingRoutes);

// Phase 2.4 (report.md Phase 2 plan): public Business/Professional/Category
// discovery, replacing studio.routes.js + barber.public.routes.js (both
// deleted - queried the dropped studios/barbers tables, 100% broken since
// Phase 1, no working frontend integration to stay compatible with).
app.use("/api/discover", discoveryRoutes);

app.use("/api/reviews", reviewRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/payments", paymentRoutes);

// Public team-invite accept flow. Its owner-side counterpart lives on
// /api/business/:studioId/invites; this half must stay unauthenticated because
// the invitee has no account until they accept.
app.use("/api/invites", inviteRoutes);

// Registration order matters here: businessRoutes (literal /, /mine paths
// only) must be tried before businessOperationsRoutes (mounted with a
// :studioId param that would otherwise swallow "/mine" as if it were a
// business id - see business.routes.js's comment for the bug this caused).
app.use("/api/business", businessRoutes);

// Phase 2.1 business-side scheduling + Phase 2.2 Business Management (report.md
// Phase 2 plan): business profile/team/service catalog CRUD + dashboard/
// analytics, all :studioId-scoped. See businessOperations.routes.js.
app.use("/api/business/:studioId", businessOperationsRoutes);

// Phase 1.3c - Professional Self-Service. Resolves the caller's own membership;
// never accepts a member id from the request. See me.routes.js.
app.use("/api/me", meRoutes);

app.use("/api/categories", categoryRoutes);

// Phase 4A (Explore Map - Location Foundation): authenticated proxy for
// address <-> coordinate lookups, used by the onboarding Location step and the
// business profile's pin editor. Proxied rather than called from the browser
// because the provider's rate budget is deployment-wide - see
// geocoding.service.js.
app.use("/api/geocoding", geocodingRoutes);

app.get("/api/health", async (req, res) => {
  try {
    await knex.raw("select 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("Health check failed: database unreachable", { error: err.message });
    res.status(503).json({ status: "error", timestamp: new Date().toISOString() });
  }
});

// Must be registered last - Express 5 forwards rejected async handler
// promises here automatically (see errorHandler.middleware.js).
app.use(errorHandler);

const startServer = async () => {
  // Schema is managed entirely by Knex migrations now (`npm run db:migrate`),
  // not a runtime sync step - see report.md "Database Layer Migration to Knex.js".
  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    logger.info("Server started", { port: Number(port) });
  });
};

startServer();
