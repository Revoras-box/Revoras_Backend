import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import session from "express-session";
import path from "path";
import { fileURLToPath } from "url";

import userRoutes from "./routes/user.routes.js";
import studioManageRoutes from "./routes/barber.routes.js";
import studioAuthRoutes from "./routes/studio.auth.routes.js";
import verificationRoutes from "./routes/verification.routes.js";
import googleRoutes from "./routes/google.routes.js";
import passwordRoutes from "./routes/password.routes.js";
import bookingRoutes from "./routes/booking.routes.js";
import studioRoutes from "./routes/studio.routes.js";
import studioSettingsRoutes from "./routes/studio.settings.routes.js";
import reviewRoutes from "./routes/review.routes.js";
import profileRoutes from "./routes/profile.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { ensureModelAttributes } from "./config/modelAttributeSync.js";
import { requestLogger } from "./middlewares/requestLogger.middleware.js";
import { logger } from "./utils/logger.js";
import passport from "passport";
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

app.use(requestLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "session_secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

import "./config/passport.js";
app.use(passport.initialize());
app.use(passport.session());

// User routes
app.use("/api/users", userRoutes);

// Studio auth routes (owner signup/login, barber management)
app.use("/api/studios", studioAuthRoutes);

// Studio management routes (for logged-in studio owners/barbers)
app.use("/api/studios/manage", studioManageRoutes);

// Admin routes
app.use("/api/admin", adminRoutes);

// Other routes
app.use("/api/verification", verificationRoutes);
app.use("/api/auth/google", googleRoutes);
app.use("/api/password", passwordRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/studios", studioRoutes);
app.use("/api/studio", studioSettingsRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/profile", profileRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

const startServer = async () => {
  try {
    await ensureModelAttributes();
    const port = process.env.PORT || 5000;
    app.listen(port, () => {
      logger.info("Server started", { port: Number(port) });
    });
  } catch (error) {
    logger.error("Failed to sync database schema", error);
    process.exit(1);
  }
};

startServer();
