import { col, timestamps } from "./_base.model.js";

export const UserFavoritesModel = {
  table: "user_favorites",
  columns: {
    id: col("uuid", { primaryKey: true }),
    user_id: col("uuid", { required: true, references: "users.id" }),
    studio_id: col("uuid", { required: true, references: "studios.id" }),
    ...timestamps,
  },
  unique: [["user_id", "studio_id"]],
};

