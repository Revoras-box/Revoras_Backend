import * as categoryService from "../services/category.service.js";
import { listCategoriesQuerySchema } from "../validators/category.validator.js";

// GET /api/categories
export const listCategories = async (req, res) => {
  const { type } = listCategoriesQuerySchema.parse(req.query);
  const categories = await categoryService.listCategories(type);
  res.json({ categories });
};
