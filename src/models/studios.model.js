import { col, timestamps } from "./_base.model.js";

export const StudiosModel = {
  table: "studios",
  columns: {
    id: col("uuid", { primaryKey: true }),
    name: col("string", { required: true }),
    address: col("string", { required: true }),
    city: col("string"),
    state: col("string"),
    zip_code: col("string"),
    country: col("string"),
    lat: col("float"),
    lng: col("float"),
    phone: col("string"),
    email: col("string"),
    description: col("text"),
    image_url: col("string"),
    logo_url: col("string"),
    banner_url: col("string"),
    amenities: col("jsonb", { default: [] }),
    rating: col("decimal", { default: 0 }),
    review_count: col("integer", { default: 0 }),
    approval_status: col("enum", {
      values: ["pending", "approved", "rejected", "suspended"],
      default: "pending",
    }),
    approved_by: col("uuid", { references: "admins.id" }),
    approved_at: col("timestamp"),
    rejection_reason: col("text"),
    admin_notes: col("text"),
    is_active: col("boolean", { default: false }),
    ...timestamps,
  },
};

