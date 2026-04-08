import pool from "../config/db.js";
import { sanitizeString } from "../utils/validation.js";

/**
 * Get user profile
 * GET /api/profile
 */
export const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT 
        id, 
        email, 
        name, 
        phone, 
        avatar_url,
        date_of_birth,
        gender,
        preferences,
        notification_settings,
        created_at,
        updated_at
      FROM users 
      WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get loyalty stats
    const loyaltyStats = await pool.query(
      `SELECT 
        COUNT(*) as total_bookings,
        SUM(CASE WHEN status = 'completed' THEN total_amount ELSE 0 END) as total_spent,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_bookings
      FROM bookings
      WHERE user_id = $1`,
      [userId]
    );

    // Get favorite studios
    const favorites = await pool.query(
      `SELECT 
        s.id, s.name, s.image_url, s.rating
      FROM user_favorites uf
      JOIN studios s ON uf.studio_id = s.id
      WHERE uf.user_id = $1
      LIMIT 5`,
      [userId]
    );

    res.json({
      user: result.rows[0],
      stats: {
        totalBookings: Number(loyaltyStats.rows[0].total_bookings),
        totalSpent: parseFloat(loyaltyStats.rows[0].total_spent || 0),
        completedBookings: Number(loyaltyStats.rows[0].completed_bookings),
        loyaltyPoints: Number(loyaltyStats.rows[0].completed_bookings) * 10 // Example: 10 points per booking
      },
      favoriteStudios: favorites.rows
    });
  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
};

/**
 * Update user profile
 * PUT /api/profile
 */
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, phone, dateOfBirth, gender, avatarUrl } = req.body;

    const updates = [];
    const params = [];

    if (name !== undefined) {
      params.push(sanitizeString(name));
      updates.push(`name = $${params.length}`);
    }
    if (phone !== undefined) {
      params.push(phone);
      updates.push(`phone = $${params.length}`);
    }
    if (dateOfBirth !== undefined) {
      params.push(dateOfBirth);
      updates.push(`date_of_birth = $${params.length}`);
    }
    if (gender !== undefined) {
      params.push(gender);
      updates.push(`gender = $${params.length}`);
    }
    if (avatarUrl !== undefined) {
      params.push(avatarUrl);
      updates.push(`avatar_url = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(userId);
    const query = `
      UPDATE users 
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING id, email, name, phone, avatar_url, date_of_birth, gender
    `;

    const result = await pool.query(query, params);

    res.json({
      message: "Profile updated successfully",
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
};

/**
 * Update notification preferences
 * PUT /api/profile/notifications
 */
export const updateNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { email, push, sms, marketing } = req.body;

    const settings = {
      email: email ?? true,
      push: push ?? true,
      sms: sms ?? false,
      marketing: marketing ?? false
    };

    await pool.query(
      `UPDATE users SET notification_settings = $1, updated_at = NOW() WHERE id = $2`,
      [settings, userId]
    );

    res.json({
      message: "Notification preferences updated",
      settings
    });
  } catch (error) {
    console.error("Update notifications error:", error);
    res.status(500).json({ error: "Failed to update notifications" });
  }
};

/**
 * Add studio to favorites
 * POST /api/profile/favorites/:studioId
 */
export const addFavorite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { studioId } = req.params;

    // Check if already favorited
    const existing = await pool.query(
      `SELECT id FROM user_favorites WHERE user_id = $1 AND studio_id = $2`,
      [userId, studioId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Studio already in favorites" });
    }

    await pool.query(
      `INSERT INTO user_favorites (user_id, studio_id) VALUES ($1, $2)`,
      [userId, studioId]
    );

    res.status(201).json({ message: "Added to favorites" });
  } catch (error) {
    console.error("Add favorite error:", error);
    res.status(500).json({ error: "Failed to add favorite" });
  }
};

/**
 * Remove studio from favorites
 * DELETE /api/profile/favorites/:studioId
 */
export const removeFavorite = async (req, res) => {
  try {
    const userId = req.user.id;
    const { studioId } = req.params;

    await pool.query(
      `DELETE FROM user_favorites WHERE user_id = $1 AND studio_id = $2`,
      [userId, studioId]
    );

    res.json({ message: "Removed from favorites" });
  } catch (error) {
    console.error("Remove favorite error:", error);
    res.status(500).json({ error: "Failed to remove favorite" });
  }
};

/**
 * Get user favorites
 * GET /api/profile/favorites
 */
export const getFavorites = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT 
        s.*,
        uf.created_at as favorited_at
      FROM user_favorites uf
      JOIN studios s ON uf.studio_id = s.id
      WHERE uf.user_id = $1
      ORDER BY uf.created_at DESC`,
      [userId]
    );

    res.json({ favorites: result.rows });
  } catch (error) {
    console.error("Get favorites error:", error);
    res.status(500).json({ error: "Failed to fetch favorites" });
  }
};

/**
 * Delete user account
 * DELETE /api/profile
 */
export const deleteAccount = async (req, res) => {
  try {
    const userId = req.user.id;
    const { password } = req.body;

    // Verify password
    const user = await pool.query(
      `SELECT password FROM users WHERE id = $1`,
      [userId]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Import bcrypt here to avoid issues
    const bcrypt = await import("bcrypt");
    const valid = await bcrypt.compare(password, user.rows[0].password);

    if (!valid) {
      return res.status(401).json({ error: "Invalid password" });
    }

    // Soft delete - mark as inactive
    await pool.query(
      `UPDATE users 
       SET is_active = false, 
           email = CONCAT('deleted_', id, '_', email),
           updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    res.json({ message: "Account deleted successfully" });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ error: "Failed to delete account" });
  }
};
