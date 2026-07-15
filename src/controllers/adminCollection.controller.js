import * as collectionService from "../services/collection.service.js";
import {
  createCollectionSchema,
  updateCollectionSchema,
  listCollectionsQuerySchema,
  resolveQuerySchema,
  pinBusinessSchema,
  reorderItemsSchema,
} from "../validators/collection.validator.js";

// GET /api/admin/collections
export const listCollections = async (req, res) => {
  const query = listCollectionsQuerySchema.parse(req.query);
  const result = await collectionService.list(query);
  res.json(result);
};

// GET /api/admin/collections/:id
export const getCollection = async (req, res) => {
  const collection = await collectionService.getById(req.params.id);
  res.json({ collection });
};

// GET /api/admin/collections/:id/preview - "preview ranking impact": the
// exact same resolved feed a customer would see, so an admin can check their
// filter criteria + pinning before publishing.
export const previewCollection = async (req, res) => {
  const query = resolveQuerySchema.parse(req.query);
  const collectionRow = await collectionService.getById(req.params.id);
  const result = await collectionService.resolve({ collection: collectionRow, ...query });
  res.json(result);
};

// POST /api/admin/collections
export const createCollection = async (req, res) => {
  const input = createCollectionSchema.parse(req.body);
  const collection = await collectionService.create(input, req.user.id);
  res.status(201).json({ message: "Collection created", collection });
};

// PATCH /api/admin/collections/:id
export const updateCollection = async (req, res) => {
  const input = updateCollectionSchema.parse(req.body);
  const collection = await collectionService.update(req.params.id, input);
  res.json({ message: "Collection updated", collection });
};

// DELETE /api/admin/collections/:id
export const deleteCollection = async (req, res) => {
  await collectionService.remove(req.params.id);
  res.json({ message: "Collection deleted" });
};

// POST /api/admin/collections/:id/duplicate
export const duplicateCollection = async (req, res) => {
  const collection = await collectionService.duplicate(req.params.id, req.user.id);
  res.status(201).json({ message: "Collection duplicated", collection });
};

// POST /api/admin/collections/:id/items
export const pinBusiness = async (req, res) => {
  const { businessId } = pinBusinessSchema.parse(req.body);
  const items = await collectionService.pinBusiness(req.params.id, businessId);
  res.json({ message: "Business pinned", items });
};

// DELETE /api/admin/collections/:id/items/:businessId
export const unpinBusiness = async (req, res) => {
  const items = await collectionService.unpinBusiness(req.params.id, req.params.businessId);
  res.json({ message: "Business unpinned", items });
};

// PATCH /api/admin/collections/:id/items/reorder
export const reorderItems = async (req, res) => {
  const { orderedBusinessIds } = reorderItemsSchema.parse(req.body);
  const items = await collectionService.reorderItems(req.params.id, orderedBusinessIds);
  res.json({ message: "Order updated", items });
};
