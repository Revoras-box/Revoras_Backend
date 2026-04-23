import { col, timestamps } from "./_base.model.js";

export const BarbersModel = {
  table: "barbers",
  columns: {
    id: col("uuid", { primaryKey: true }),
    studio_id: col("uuid", { references: "studios.id" }),
    name: col("string", { required: true }),
    salon_name: col("string"),
    email: col("string", { unique: true }),
    phone: col("string", { required: true, unique: true }),
    password: col("string", { required: true }),
    title: col("string"),
    specialties: col("jsonb", { default: [] }),
    experience_years: col("integer", { default: 0 }),
    rating: col("decimal", { default: 0 }),
    image_url: col("string"),
    email_verified: col("boolean", { default: false }),
    phone_verified: col("boolean", { default: false }),
    registration_fee_paid: col("boolean", { default: false }),
    registration_fee_amount: col("decimal", { default: 0 }),
    registration_payment_id: col("string", { unique: true }),
    registration_order_id: col("string"),
    registration_paid_at: col("timestamp"),
    is_active: col("boolean", { default: true }),
    ...timestamps,
  },
};

