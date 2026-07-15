import * as reviewService from "../services/review.service.js";
import {
  createReviewSchema,
  updateReviewSchema,
  listReviewsQuerySchema,
  paginationQuerySchema,
} from "../validators/review.validator.js";

// POST /api/reviews
export const createReview = async (req, res) => {
  const input = createReviewSchema.parse(req.body);
  const review = await reviewService.create(req.user.id, input);
  res.status(201).json({ message: "Review submitted successfully", review });
};

// PATCH /api/reviews/:id
export const updateReview = async (req, res) => {
  const input = updateReviewSchema.parse(req.body);
  const review = await reviewService.update(req.user.id, req.params.id, input);
  res.json({ message: "Review updated successfully", review });
};

// DELETE /api/reviews/:id
export const deleteReview = async (req, res) => {
  await reviewService.remove(req.user.id, req.params.id);
  res.json({ message: "Review deleted successfully" });
};

// GET /api/reviews/business/:studioId
export const getBusinessReviews = async (req, res) => {
  const query = listReviewsQuerySchema.parse(req.query);
  const result = await reviewService.listForBusiness(req.params.studioId, query);
  res.json(result);
};

// GET /api/reviews/professional/:memberId
export const getProfessionalReviews = async (req, res) => {
  const query = paginationQuerySchema.parse(req.query);
  const result = await reviewService.listForProfessional(req.params.memberId, query);
  res.json(result);
};

// GET /api/reviews/me
export const getMyReviews = async (req, res) => {
  const query = paginationQuerySchema.parse(req.query);
  const result = await reviewService.listForUser(req.user.id, query);
  res.json(result);
};

// POST /api/reviews/:id/helpful
export const markHelpful = async (req, res) => {
  await reviewService.markHelpful(req.user.id, req.params.id);
  res.json({ message: "Marked as helpful" });
};

// DELETE /api/reviews/:id/helpful
export const unmarkHelpful = async (req, res) => {
  await reviewService.unmarkHelpful(req.user.id, req.params.id);
  res.json({ message: "Removed helpful mark" });
};
