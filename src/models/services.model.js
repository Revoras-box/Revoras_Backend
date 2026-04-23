import { col, timestamps } from "./_base.model.js";

export const ServicesModel = {
  table: "services",
  columns: {
    id: col("uuid", { primaryKey: true }),
    studio_id: col("uuid", { required: true, references: "studios.id" }),
    name: col("string", { required: true }),
    description: col("text"),
    category: col("string", { default: "General" }),
    price: col("decimal", { required: true }),
    duration: col("integer", { required: true }),
    image_url: col("string"),
    is_active: col("boolean", { default: true }),
    ...timestamps,
  },
};

