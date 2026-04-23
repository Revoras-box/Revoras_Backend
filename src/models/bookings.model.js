import { col, timestamps } from "./_base.model.js";

export const BookingsModel = {
  table: "bookings",
  columns: {
    id: col("uuid", { primaryKey: true }),
    user_id: col("uuid", { references: "users.id" }),
    studio_id: col("uuid", { required: true, references: "studios.id" }),
    barber_id: col("uuid", { required: true, references: "barbers.id" }),
    appointment_date: col("date", { required: true }),
    appointment_time: col("time", { required: true }),
    total_price: col("decimal", { default: 0 }),
    total_amount: col("decimal", { default: 0 }),
    total_duration: col("integer", { default: 0 }),
    notes: col("text"),
    status: col("enum", {
      values: ["pending", "confirmed", "completed", "cancelled", "no_show"],
      default: "pending",
    }),
    payment_status: col("enum", { values: ["pending", "paid", "failed"], default: "pending" }),
    payment_method: col("string", { default: "card" }),
    confirmation_code: col("string", { unique: true }),
    cancellation_reason: col("text"),
    cancelled_at: col("timestamp"),
    ...timestamps,
  },
};

