import { col, timestamps } from "./_base.model.js";

export const StudioOwnersModel = {
  table: "studio_owners",
  columns: {
    id: col("uuid", { primaryKey: true }),
    studio_id: col("uuid", { required: true, references: "studios.id" }),
    name: col("string", { required: true }),
    email: col("string", { required: true, unique: true }),
    phone: col("string", { required: true, unique: true }),
    password: col("string", { required: true }),
    role: col("string", { default: "owner" }),
    image_url: col("string"),
    email_verified: col("boolean", { default: false }),
    phone_verified: col("boolean", { default: false }),
    is_active: col("boolean", { default: true }),
    ...timestamps,
  },
};

