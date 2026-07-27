import { logger } from "../utils/logger.js";

/**
 * Some secrets travel in the URL rather than the body, because the flows that
 * carry them are links someone clicks: team invites (`/api/invites/:token`)
 * and password reset. Logging the raw URL therefore writes working
 * credentials into the log stream - which is copied, shipped to aggregators,
 * and retained far longer and far more widely than anything holding live
 * bearer tokens should be. Anyone with log access could accept an invite or
 * take over an account without ever touching the app.
 *
 * So the token is replaced before the line is written. The path shape is kept
 * intact, which is all the logs were ever useful for.
 */
const REDACTIONS = [
  // /api/invites/<token> and /api/invites/<token>/accept
  [/(\/invites\/)[^/?#]+/gi, "$1[redacted]"],
  // ?token=... / ?otp=... / ?code=... / ?key=... in any query string
  [/([?&](?:token|otp|code|secret|key|password|signature)=)[^&#]*/gi, "$1[redacted]"],
];

const redactUrl = (url) => REDACTIONS.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), url || "");

export const requestLogger = (req, res, next) => {
  const startTime = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    logger.info("HTTP request", {
      method: req.method,
      path: redactUrl(req.originalUrl || req.url),
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip || req.socket?.remoteAddress || "unknown",
      userAgent: req.get("user-agent"),
    });
  });

  next();
};
