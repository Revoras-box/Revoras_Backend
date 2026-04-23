import { col, timestamps } from "./_base.model.js";

export const ReviewsModel = {
  table: "reviews",
  columns: {
    id: col("uuid", { primaryKey: true }),
    user_id: col("uuid", { required: true, references: "users.id" }),
    booking_id: col("uuid", { references: "bookings.id", unique: true }),
    studio_id: col("uuid", { required: true, references: "studios.id" }),
    barber_id: col("uuid", { references: "barbers.id" }),
    rating: col("integer", { required: true }),
    title: col("string"),
    comment: col("text"),
    photos: col("jsonb", { default: [] }),
    helpful_count: col("integer", { default: 0 }),
    ...timestamps,
  },
};

