export const col = (type, options = {}) => ({ type, ...options });

export const timestamps = {
  created_at: col("timestamp", { default: "now" }),
  updated_at: col("timestamp", { default: "now" }),
};

