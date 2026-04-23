import { col, timestamps } from "./_base.model.js";

export const AdminActivityLogModel = {
  table: "admin_activity_log",
  columns: {
    id: col("uuid", { primaryKey: true }),
    admin_id: col("uuid", { required: true, references: "admins.id" }),
    action: col("string", { required: true }),
    entity_type: col("string", { required: true }),
    entity_id: col("uuid"),
    details: col("jsonb", { default: {} }),
    ip_address: col("string"),
    ...timestamps,
  },
};

