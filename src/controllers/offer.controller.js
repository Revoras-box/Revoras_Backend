import * as offerService from "../services/offer.service.js";
import { createOfferSchema, updateOfferSchema } from "../validators/offer.validator.js";

// GET /api/business/:studioId/offers
export const listOffers = async (req, res) => {
  const offers = await offerService.list(req.params.studioId);
  res.json({ offers });
};

// GET /api/business/:studioId/offers/:offerId
export const getOffer = async (req, res) => {
  const offer = await offerService.getById(req.params.offerId, req.params.studioId);
  res.json({ offer });
};

// POST /api/business/:studioId/offers
export const createOffer = async (req, res) => {
  const input = createOfferSchema.parse(req.body);
  const offer = await offerService.create(req.params.studioId, input, req.user.id);
  res.status(201).json({ message: "Offer created", offer });
};

// PATCH /api/business/:studioId/offers/:offerId
export const updateOffer = async (req, res) => {
  const input = updateOfferSchema.parse(req.body);
  const offer = await offerService.update(req.params.offerId, req.params.studioId, input);
  res.json({ message: "Offer updated", offer });
};

// DELETE /api/business/:studioId/offers/:offerId
export const deleteOffer = async (req, res) => {
  await offerService.remove(req.params.offerId, req.params.studioId);
  res.json({ message: "Offer deleted" });
};
