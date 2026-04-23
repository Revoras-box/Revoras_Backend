import { logger } from "../utils/logger.js";

export const requestLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    logger.info("HTTP request", {
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip || req.socket?.remoteAddress || "unknown",
      userAgent: req.get("user-agent"),
    });
  });

  next();
};
