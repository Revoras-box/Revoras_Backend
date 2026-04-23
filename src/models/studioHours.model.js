import { col, timestamps } from "./_base.model.js";

export const StudioHoursModel = {
  table: "studio_hours",
  columns: {
    id: col("uuid", { primaryKey: true }),
    studio_id: col("uuid", { required: true, references: "studios.id" }),
    day_of_week: col("integer", { required: true }),
    open_time: col("time"),
    close_time: col("time"),
    is_closed: col("boolean", { default: false }),
    ...timestamps,
  },
  unique: [["studio_id", "day_of_week"]],
};

