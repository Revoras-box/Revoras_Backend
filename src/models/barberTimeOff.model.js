import { col, timestamps } from "./_base.model.js";

export const BarberTimeOffModel = {
  table: "barber_time_off",
  columns: {
    id: col("uuid", { primaryKey: true }),
    studio_id: col("uuid", { required: true, references: "studios.id" }),
    barber_id: col("uuid", { required: true, references: "barbers.id" }),
    date: col("date", { required: true }),
    start_time: col("time"),
    end_time: col("time"),
    is_full_day: col("boolean", { default: false }),
    reason: col("text"),
    ...timestamps,
  },
};
