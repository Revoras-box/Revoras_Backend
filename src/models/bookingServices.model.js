import { col, timestamps } from "./_base.model.js";

export const BookingServicesModel = {
  table: "booking_services",
  columns: {
    id: col("uuid", { primaryKey: true }),
    booking_id: col("uuid", { required: true, references: "bookings.id" }),
    service_id: col("uuid", { required: true, references: "services.id" }),
    price: col("decimal"),
    duration: col("integer"),
    ...timestamps,
  },
};

