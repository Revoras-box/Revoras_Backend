import { col, timestamps } from "./_base.model.js";

export const AdminsModel = {
  table: "admins",
  columns: {
    id: col("uuid", { primaryKey: true }),
    name: col("string", { required: true }),
    email: col("string", { required: true, unique: true }),
    password: col("string", { required: true }),
    role: col("enum", { values: ["admin", "super_admin"], default: "admin" }),
    is_active: col("boolean", { default: true }),
    last_login: col("timestamp"),
    ...timestamps,
  },
};

