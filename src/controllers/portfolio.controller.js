import * as portfolioService from "../services/portfolio.service.js";
import { reorderPortfolioSchema, captionSchema } from "../validators/portfolio.validator.js";

// GET /api/business/:studioId/members/:memberId/portfolio
export const listPortfolio = async (req, res) => {
  const images = await portfolioService.listPortfolio(req.params.studioId, req.params.memberId);
  res.json({ images });
};

// POST /api/business/:studioId/members/:memberId/portfolio
export const addPortfolioImage = async (req, res) => {
  const { caption } = captionSchema.parse(req.body ?? {});
  const image = await portfolioService.addPortfolioImage(req.params.studioId, req.params.memberId, req.file, caption);
  res.status(201).json({ message: "Image added to portfolio", image });
};

// DELETE /api/business/:studioId/members/:memberId/portfolio/:imageId
export const removePortfolioImage = async (req, res) => {
  const images = await portfolioService.removePortfolioImage(req.params.studioId, req.params.memberId, req.params.imageId);
  res.json({ message: "Image removed from portfolio", images });
};

// PATCH /api/business/:studioId/members/:memberId/portfolio/reorder
export const reorderPortfolio = async (req, res) => {
  const { orderedImageIds } = reorderPortfolioSchema.parse(req.body);
  const images = await portfolioService.reorderPortfolio(req.params.studioId, req.params.memberId, orderedImageIds);
  res.json({ message: "Portfolio reordered", images });
};

// PATCH /api/business/:studioId/members/:memberId/portfolio/:imageId/cover
export const setCoverImage = async (req, res) => {
  const images = await portfolioService.setCoverImage(req.params.studioId, req.params.memberId, req.params.imageId);
  res.json({ message: "Cover image updated", images });
};

// PATCH /api/business/:studioId/members/:memberId/portfolio/:imageId
export const updatePortfolioCaption = async (req, res) => {
  const { caption } = captionSchema.parse(req.body ?? {});
  const images = await portfolioService.updateCaption(req.params.studioId, req.params.memberId, req.params.imageId, caption);
  res.json({ message: "Caption updated", images });
};
