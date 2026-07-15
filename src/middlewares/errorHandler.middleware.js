import { ZodError } from "zod";
import { MulterError } from "multer";
import { ServiceError } from "../utils/ServiceError.js";
import { logger } from "../utils/logger.js";

/**
 * Express 5 forwards rejected promises from async route handlers here
 * automatically - no per-controller try/catch needed. This is what lets
 * controllers stay thin (report.md Phase 2 architectural rules).
 */
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof ServiceError) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    });
  }

  if (err instanceof MulterError) {
    return res.status(400).json({ error: err.message });
  }

  logger.error("Unhandled request error", err);
  res.status(500).json({ error: "Internal server error" });
};
