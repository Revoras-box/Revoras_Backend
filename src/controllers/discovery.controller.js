import * as discoveryService from "../services/discovery.service.js";
import * as collectionService from "../services/collection.service.js";
import { listBusinessesQuerySchema, mapQuerySchema } from "../validators/discovery.validator.js";
import { listActiveQuerySchema, resolveQuerySchema } from "../validators/collection.validator.js";

// GET /api/discover/businesses
export const listBusinesses = async (req, res) => {
  const query = listBusinessesQuerySchema.parse(req.query);
  const result = await discoveryService.listBusinesses(query);
  res.json(result);
};

// GET /api/discover/businesses/map
export const listForMap = async (req, res) => {
  const query = mapQuerySchema.parse(req.query);
  const businesses = await discoveryService.listForMap(query);
  res.json({ businesses });
};

// GET /api/discover/businesses/:id
export const getBusiness = async (req, res) => {
  const business = await discoveryService.getBusiness(req.params.id);
  res.json({ business });
};

// GET /api/discover/businesses/:id/services
export const getBusinessServices = async (req, res) => {
  const services = await discoveryService.getBusinessServices(req.params.id);
  res.json({ services });
};

// GET /api/discover/businesses/:id/professionals
export const getBusinessProfessionals = async (req, res) => {
  const professionals = await discoveryService.getBusinessProfessionals(req.params.id);
  res.json({ professionals });
};

// GET /api/discover/professionals/:id
export const getProfessional = async (req, res) => {
  const professional = await discoveryService.getProfessional(req.params.id);
  res.json({ professional });
};

// GET /api/discover/collections - Phase 2.2 (Discovery Curation System).
// Public feed: only active, currently-in-window collections.
export const listCollections = async (req, res) => {
  const query = listActiveQuerySchema.parse(req.query);
  const collections = await collectionService.listActive(query);
  res.json({ collections });
};

// GET /api/discover/collections/:slug - only ever resolves a published
// (active, currently in its window) collection; anything else 404s rather
// than leaking a draft/scheduled collection to a slug guess.
export const getCollection = async (req, res) => {
  const query = resolveQuerySchema.parse(req.query);
  const collection = await collectionService.getPublishedBySlug(req.params.slug);
  const result = await collectionService.resolve({ collection, ...query });
  res.json(result);
};
