import pool from "../config/db.js";
import { sanitizeString } from "../utils/validation.js";

/**
 * Create a review
 * POST /api/reviews
 */
export const createReview = async (req, res) => {
  try {
    const userId = req.user.id;
    const { bookingId, studioId, barberId, rating, title, comment, photos } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    // Verify booking exists and belongs to user
    if (bookingId) {
      const booking = await pool.query(
        `SELECT * FROM bookings 
         WHERE id = $1 AND user_id = $2 AND status = 'completed'`,
        [bookingId, userId]
      );

      if (booking.rows.length === 0) {
        return res.status(404).json({ error: "Completed booking not found" });
      }

      // Check if already reviewed
      const existingReview = await pool.query(
        `SELECT id FROM reviews WHERE booking_id = $1`,
        [bookingId]
      );

      if (existingReview.rows.length > 0) {
        return res.status(400).json({ error: "Booking already reviewed" });
      }
    }

    // Create review
    const result = await pool.query(
      `INSERT INTO reviews 
       (id, user_id, booking_id, studio_id, barber_id, rating, title, comment, photos, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, NOW())
       RETURNING *`,
      [
        userId,
        bookingId || null,
        studioId,
        barberId || null,
        rating,
        sanitizeString(title || ""),
        sanitizeString(comment || ""),
        photos || []
      ]
    );

    // Update studio average rating
    await pool.query(
      `UPDATE studios 
       SET rating = (
         SELECT ROUND(AVG(rating)::numeric, 1) 
         FROM reviews WHERE studio_id = $1
       ),
       review_count = (
         SELECT COUNT(*) FROM reviews WHERE studio_id = $1
       )
       WHERE id = $1`,
      [studioId]
    );

    // Update barber rating if applicable
    if (barberId) {
      await pool.query(
        `UPDATE barbers 
         SET rating = (
           SELECT ROUND(AVG(rating)::numeric, 1) 
           FROM reviews WHERE barber_id = $1
         )
         WHERE id = $1`,
        [barberId]
      );
    }

    res.status(201).json({
      message: "Review submitted successfully",
      review: result.rows[0]
    });
  } catch (error) {
    console.error("Create review error:", error);
    res.status(500).json({ error: "Failed to create review" });
  }
};

/**
 * Get reviews for studio
 * GET /api/reviews/studio/:studioId
 */
export const getStudioReviews = async (req, res) => {
  try {
    const { studioId } = req.params;
    const { rating, sortBy = "recent", page = 1, limit = 10 } = req.query;

    let query = `
      SELECT 
        r.*,
        u.name as user_name,
        u.avatar_url as user_avatar,
        br.name as barber_name
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN barbers br ON r.barber_id = br.id
      WHERE r.studio_id = $1
    `;

    const params = [studioId];

    if (rating) {
      params.push(rating);
      query += ` AND r.rating = $${params.length}`;
    }

    // Sorting
    switch (sortBy) {
      case "highest":
        query += ` ORDER BY r.rating DESC, r.created_at DESC`;
        break;
      case "lowest":
        query += ` ORDER BY r.rating ASC, r.created_at DESC`;
        break;
      case "helpful":
        query += ` ORDER BY r.helpful_count DESC, r.created_at DESC`;
        break;
      default:
        query += ` ORDER BY r.created_at DESC`;
    }

    params.push(limit, (page - 1) * limit);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Get rating distribution
    const distribution = await pool.query(
      `SELECT 
        rating, 
        COUNT(*) as count
       FROM reviews 
       WHERE studio_id = $1
       GROUP BY rating
       ORDER BY rating DESC`,
      [studioId]
    );

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*), AVG(rating) as avg_rating FROM reviews WHERE studio_id = $1`,
      [studioId]
    );

    res.json({
      reviews: result.rows,
      stats: {
        total: Number(countResult.rows[0].count),
        averageRating: parseFloat(countResult.rows[0].avg_rating || 0).toFixed(1),
        distribution: distribution.rows
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error("Get reviews error:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
};

/**
 * Get reviews for barber
 * GET /api/reviews/barber/:barberId
 */
export const getBarberReviews = async (req, res) => {
  try {
    const { barberId } = req.params;
    const { page = 1, limit = 10 } = req.query;

    const result = await pool.query(
      `SELECT 
        r.*,
        u.name as user_name,
        u.avatar_url as user_avatar,
        s.name as studio_name
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      LEFT JOIN studios s ON r.studio_id = s.id
      WHERE r.barber_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
      [barberId, limit, (page - 1) * limit]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*), AVG(rating) as avg_rating FROM reviews WHERE barber_id = $1`,
      [barberId]
    );

    res.json({
      reviews: result.rows,
      stats: {
        total: Number(countResult.rows[0].count),
        averageRating: parseFloat(countResult.rows[0].avg_rating || 0).toFixed(1)
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countResult.rows[0].count)
      }
    });
  } catch (error) {
    console.error("Get barber reviews error:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
};

/**
 * Mark review as helpful
 * POST /api/reviews/:id/helpful
 */
export const markHelpful = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Check if already marked
    const existing = await pool.query(
      `SELECT id FROM review_helpful WHERE review_id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Already marked as helpful" });
    }

    // Add helpful mark
    await pool.query(
      `INSERT INTO review_helpful (id, review_id, user_id) VALUES (gen_random_uuid(), $1, $2)`,
      [id, userId]
    );

    // Update count
    await pool.query(
      `UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = $1`,
      [id]
    );

    res.json({ message: "Marked as helpful" });
  } catch (error) {
    console.error("Mark helpful error:", error);
    res.status(500).json({ error: "Failed to mark as helpful" });
  }
};

/**
 * Get user's reviews
 * GET /api/reviews/me
 */
export const getMyReviews = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const result = await pool.query(
      `SELECT 
        r.*,
        s.name as studio_name,
        s.image_url as studio_image,
        br.name as barber_name
      FROM reviews r
      LEFT JOIN studios s ON r.studio_id = s.id
      LEFT JOIN barbers br ON r.barber_id = br.id
      WHERE r.user_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
      [userId, limit, (page - 1) * limit]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM reviews WHERE user_id = $1`,
      [userId]
    );

    res.json({
      reviews: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countResult.rows[0].count)
      }
    });
  } catch (error) {
    console.error("Get my reviews error:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
};
