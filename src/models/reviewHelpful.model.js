import { col, timestamps } from "./_base.model.js";

export const ReviewHelpfulModel = {
  table: "review_helpful",
  columns: {
    id: col("uuid", { primaryKey: true }),
    review_id: col("uuid", { required: true, references: "reviews.id" }),
    user_id: col("uuid", { required: true, references: "users.id" }),
    ...timestamps,
  },
  unique: [["review_id", "user_id"]],
};

