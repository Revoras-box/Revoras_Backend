const LOG_LEVEL_PRIORITY = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const LOG_METHOD_BY_LEVEL = {
  error: "error",
  warn: "warn",
  info: "log",
  debug: "debug",
};

const DEFAULT_LEVEL = process.env.NODE_ENV === "production" ? "info" : "debug";
const ACTIVE_LEVEL =
  LOG_LEVEL_PRIORITY[process.env.LOG_LEVEL] !== undefined
    ? process.env.LOG_LEVEL
    : DEFAULT_LEVEL;

const serializeMeta = (meta) => {
  if (meta instanceof Error) {
    return {
      message: meta.message,
      stack: meta.stack,
      name: meta.name,
    };
  }

  if (!meta || typeof meta !== "object") {
    return meta;
  }

  return Object.fromEntries(
    Object.entries(meta).map(([key, value]) => [key, serializeMeta(value)])
  );
};

const shouldLog = (level) =>
  LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[ACTIVE_LEVEL];

const write = (level, message, meta) => {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };

  if (meta !== undefined) {
    payload.meta = serializeMeta(meta);
  }

  const method = LOG_METHOD_BY_LEVEL[level] || "log";
  console[method](JSON.stringify(payload));
};

export const logger = {
  error(message, meta) {
    write("error", message, meta);
  },
  warn(message, meta) {
    write("warn", message, meta);
  },
  info(message, meta) {
    write("info", message, meta);
  },
  debug(message, meta) {
    write("debug", message, meta);
  },
};
