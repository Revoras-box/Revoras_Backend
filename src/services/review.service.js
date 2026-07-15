import * as reviewRepo from "../repositories/review.repository.js";
import * as bookingRepo from "../repositories/booking.repository.js";
import { ServiceError } from "../utils/ServiceError.js";

const PG_UNIQUE_VIOLATION = "23505";

const recalcRatings = (studioId, businessMemberId) =>
  Promise.all([
    reviewRepo.recalcBusinessRating(studioId),
    businessMemberId ? reviewRepo.recalcMemberRating(businessMemberId) : null,
  ]);

/**
 * Reviews belong to a Business and (optionally) a Professional (report.md
 * Phase 2.4 plan) - both are derived from the completed booking being
 * reviewed, never accepted as free-standing input, so a review can't be
 * pinned to a business/professional the reviewer never actually booked.
 * `reviews.booking_id` is UNIQUE at the DB level, the actual duplicate-review
 * prevention mechanism; the pre-check below just gives a friendlier error.
 */
export const create = async (userId, input) => {
  const booking = await bookingRepo.findByIdForUser(input.bookingId, userId);
  if (!booking) throw new ServiceError(404, "Booking not found");
  if (booking.status !== "completed") {
    throw new ServiceError(400, "You can only review a completed booking");
  }

  const existing = await reviewRepo.findByBookingId(input.bookingId);
  if (existing) throw new ServiceError(409, "This booking has already been reviewed");

  let review;
  try {
    review = await reviewRepo.create({
      user_id: userId,
      booking_id: booking.id,
      studio_id: booking.studio_id,
      business_member_id: booking.business_member_id,
      rating: input.rating,
      title: input.title || null,
      comment: input.comment || null,
      photos: JSON.stringify(input.photos || []),
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) throw new ServiceError(409, "This booking has already been reviewed");
    throw err;
  }

  await recalcRatings(booking.studio_id, booking.business_member_id);

  return review;
};

export const update = async (userId, reviewId, input) => {
  const review = await reviewRepo.findByIdForUser(reviewId, userId);
  if (!review) throw new ServiceError(404, "Review not found");

  const patch = {};
  if (input.rating !== undefined) patch.rating = input.rating;
  if (input.title !== undefined) patch.title = input.title;
  if (input.comment !== undefined) patch.comment = input.comment;
  if (input.photos !== undefined) patch.photos = JSON.stringify(input.photos);

  if (Object.keys(patch).length === 0) {
    throw new ServiceError(400, "No fields to update");
  }

  const updated = await reviewRepo.update(reviewId, patch);

  if (input.rating !== undefined) {
    await recalcRatings(review.studio_id, review.business_member_id);
  }

  return updated;
};

export const remove = async (userId, reviewId) => {
  const review = await reviewRepo.findByIdForUser(reviewId, userId);
  if (!review) throw new ServiceError(404, "Review not found");

  await reviewRepo.remove(reviewId);
  await recalcRatings(review.studio_id, review.business_member_id);
};

export const listForBusiness = async (studioId, { rating, sortBy, page = 1, limit = 10 }) => {
  const [{ rows, total }, stats] = await Promise.all([
    reviewRepo.listForBusiness(studioId, { rating, sortBy, page: Number(page), limit: Number(limit) }),
    reviewRepo.getStatsForBusiness(studioId),
  ]);

  return {
    reviews: rows,
    stats: {
      total: Number(stats.total),
      averageRating: Number(Number(stats.avg_rating).toFixed(1)),
      distribution: {
        5: Number(stats.five_star),
        4: Number(stats.four_star),
        3: Number(stats.three_star),
        2: Number(stats.two_star),
        1: Number(stats.one_star),
      },
    },
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
  };
};

export const listForProfessional = async (memberId, { page = 1, limit = 10 }) => {
  const [{ rows, total }, stats] = await Promise.all([
    reviewRepo.listForMember(memberId, { page: Number(page), limit: Number(limit) }),
    reviewRepo.getStatsForMember(memberId),
  ]);

  return {
    reviews: rows,
    stats: { total: Number(stats.total), averageRating: Number(Number(stats.avg_rating).toFixed(1)) },
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) },
  };
};

export const listForUser = async (userId, { page = 1, limit = 10 }) => {
  const { rows, total } = await reviewRepo.listForUser(userId, { page: Number(page), limit: Number(limit) });
  return { reviews: rows, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / limit) } };
};

export const markHelpful = async (userId, reviewId) => {
  const review = await reviewRepo.findById(reviewId);
  if (!review) throw new ServiceError(404, "Review not found");

  const existing = await reviewRepo.findHelpfulMark(reviewId, userId);
  if (existing) throw new ServiceError(409, "You already marked this review as helpful");

  await reviewRepo.addHelpfulMark(reviewId, userId);
  await reviewRepo.incrementHelpfulCount(reviewId, 1);
};

export const unmarkHelpful = async (userId, reviewId) => {
  const removed = await reviewRepo.removeHelpfulMark(reviewId, userId);
  if (removed === 0) throw new ServiceError(404, "You haven't marked this review as helpful");

  await reviewRepo.incrementHelpfulCount(reviewId, -1);
};
