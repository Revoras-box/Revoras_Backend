import * as galleryService from "../services/businessGallery.service.js";
import { reorderGallerySchema } from "../validators/businessGallery.validator.js";

// GET /api/business/:studioId/gallery
export const listGallery = async (req, res) => {
  const images = await galleryService.listGallery(req.params.studioId);
  res.json({ images });
};

// POST /api/business/:studioId/gallery
export const addGalleryImage = async (req, res) => {
  const image = await galleryService.addGalleryImage(req.params.studioId, req.file);
  res.status(201).json({ message: "Image added to gallery", image });
};

// DELETE /api/business/:studioId/gallery/:imageId
export const removeGalleryImage = async (req, res) => {
  const images = await galleryService.removeGalleryImage(req.params.studioId, req.params.imageId);
  res.json({ message: "Image removed from gallery", images });
};

// PATCH /api/business/:studioId/gallery/reorder
export const reorderGallery = async (req, res) => {
  const { orderedImageIds } = reorderGallerySchema.parse(req.body);
  const images = await galleryService.reorderGallery(req.params.studioId, orderedImageIds);
  res.json({ message: "Gallery reordered", images });
};

// PATCH /api/business/:studioId/gallery/:imageId/cover
export const setCoverImage = async (req, res) => {
  const images = await galleryService.setCoverImage(req.params.studioId, req.params.imageId);
  res.json({ message: "Cover image updated", images });
};
