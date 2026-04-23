import { col, timestamps } from "./_base.model.js";

export const UsersModel = {
  table: "users",
  columns: {
    id: col("uuid", { primaryKey: true }),
    name: col("string", { required: true }),
    email: col("string", { required: true, unique: true }),
    password: col("string"),
    phone: col("string", { unique: true }),
    google_id: col("string", { unique: true }),
    avatar: col("string"),
    avatar_url: col("string"),
    date_of_birth: col("date"),
    gender: col("string"),
    preferences: col("jsonb", { default: {} }),
    notification_settings: col("jsonb", { default: {} }),
    email_verified: col("boolean", { default: false }),
    is_active: col("boolean", { default: true }),
    ...timestamps,
  },
};

