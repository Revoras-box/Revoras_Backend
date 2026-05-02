import pool from "../config/db.js";
import path from "path";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { fileURLToPath } from "url";
import { tableHasIntegerId } from "../utils/dbSchema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_UPLOADS_DIR = path.resolve(__dirname, "../../uploads/logos");
const IMAGE_EXTENSION_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const TIME_VALUE_REGEX = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/**
 * Helper to get studioId from user context
 * Works for both studio_owner and barber roles
 */
const getStudioId = (user) => {
  return user.studioId || user.studio_id;
};

/**
 * Upload studio logo image
 * POST /api/studio/upload-image
 */
export const uploadStudioLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const extension = IMAGE_EXTENSION_BY_MIME[req.file.mimetype];
    if (!extension) {
      return res
        .status(400)
        .json({ error: "Only JPG, PNG, WEBP or GIF images are accepted" });
    }

    await fs.mkdir(LOGO_UPLOADS_DIR, { recursive: true });

    const fileName = `logo-${Date.now()}-${randomUUID()}.${extension}`;
    const filePath = path.join(LOGO_UPLOADS_DIR, fileName);
    await fs.writeFile(filePath, req.file.buffer);

    const url = `${req.protocol}://${req.get("host")}/uploads/logos/${fileName}`;
    return res.json({ url, logoUrl: url });
  } catch (error) {
    console.error("Upload studio logo error:", error);
    return res.status(500).json({ error: "Failed to upload logo" });
  }
};

/**
 * Get dashboard stats for studio
 * GET /api/studios/manage/dashboard
 */
export const getBarberDashboard = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const today = new Date().toISOString().split('T')[0];

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const whereClause = `studio_id = $1`;

    // Get today's bookings count
    const todayBookings = await pool.query(
      `SELECT COUNT(*) as count, 
              COALESCE(SUM(total_price), 0) as revenue
       FROM bookings 
       WHERE ${whereClause}
       AND appointment_date = $2
       AND status NOT IN ('cancelled')`,
      [studioId, today]
    );

    // Get available slots count for today
    const defaultSlots = 18; // 9am-6pm, 30min slots
    const bookedSlots = await pool.query(
      `SELECT COUNT(*) as booked
       FROM bookings 
       WHERE ${whereClause}
       AND appointment_date = $2
       AND status NOT IN ('cancelled')`,
      [studioId, today]
    );

    // Get this week's stats
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const weekBookings = await pool.query(
      `SELECT COUNT(*) as count, 
              COALESCE(SUM(total_price), 0) as revenue
       FROM bookings 
       WHERE ${whereClause}
       AND appointment_date >= $2
       AND status = 'completed'`,
      [studioId, weekStart.toISOString().split('T')[0]]
    );

    // Get last week's stats for comparison
    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekBookings = await pool.query(
      `SELECT COUNT(*) as count, 
              COALESCE(SUM(total_price), 0) as revenue
       FROM bookings 
       WHERE ${whereClause}
       AND appointment_date >= $2
       AND appointment_date < $3
       AND status = 'completed'`,
      [studioId, lastWeekStart.toISOString().split('T')[0], weekStart.toISOString().split('T')[0]]
    );

    // Calculate change percentages
    const thisWeekRevenue = parseFloat(weekBookings.rows[0].revenue);
    const lastWeekRevenue = parseFloat(lastWeekBookings.rows[0].revenue);
    const revenueChange = lastWeekRevenue > 0 
      ? Math.round(((thisWeekRevenue - lastWeekRevenue) / lastWeekRevenue) * 100)
      : 0;

    res.json({
      today: {
        appointments: parseInt(todayBookings.rows[0].count),
        revenue: parseFloat(todayBookings.rows[0].revenue),
        availableSlots: defaultSlots - parseInt(bookedSlots.rows[0].booked),
        totalSlots: defaultSlots
      },
      week: {
        appointments: parseInt(weekBookings.rows[0].count),
        revenue: thisWeekRevenue,
        change: revenueChange
      }
    });
  } catch (error) {
    console.error("Get barber dashboard error:", error);
    res.status(500).json({ error: "Failed to fetch dashboard stats" });
  }
};

/**
 * Get barber's bookings (schedule)
 * GET /api/studios/manage/bookings
 */
export const getBarberBookings = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { date, status, page = 1, limit = 20 } = req.query;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    let query = `
      SELECT 
        b.*,
        u.name as customer_name,
        u.email as customer_email,
        u.phone as customer_phone,
        u.avatar_url as customer_image,
        s.name as studio_name,
        json_agg(json_build_object(
          'id', sv.id,
          'name', sv.name,
          'price', bs.price,
          'duration', sv.duration
        )) as services
      FROM bookings b
      JOIN users u ON b.user_id = u.id
      JOIN studios s ON b.studio_id = s.id
      LEFT JOIN booking_services bs ON b.id = bs.booking_id
      LEFT JOIN services sv ON bs.service_id = sv.id
      WHERE b.studio_id = $1
    `;

    const params = [studioId];

    if (date) {
      query += ` AND b.appointment_date = $${params.length + 1}`;
      params.push(date);
    }

    if (status) {
      query += ` AND b.status = $${params.length + 1}`;
      params.push(status);
    }

    query += `
      GROUP BY b.id, u.id, s.id
      ORDER BY b.appointment_date ASC, b.appointment_time ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    params.push(limit, (page - 1) * limit);

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(DISTINCT b.id) FROM bookings b WHERE b.studio_id = $1`;
    const countParams = [studioId];
    if (date) {
      countQuery += ` AND b.appointment_date = $2`;
      countParams.push(date);
    }
    if (status) {
      countQuery += ` AND b.status = $${countParams.length + 1}`;
      countParams.push(status);
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      bookings: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error("Get barber bookings error:", error);
    res.status(500).json({ error: "Failed to fetch bookings" });
  }
};

/**
 * Update booking status (complete, no-show, confirm)
 * PATCH /api/studios/manage/bookings/:id/status
 */
export const updateBookingStatus = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { id } = req.params;
    const { status } = req.body;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const validStatuses = ['confirmed', 'completed', 'no_show', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Check booking belongs to studio
    const booking = await pool.query(
      `SELECT * FROM bookings WHERE id = $1 AND studio_id = $2`,
      [id, studioId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    await pool.query(
      `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id]
    );

    res.json({ message: "Booking status updated", status });
  } catch (error) {
    console.error("Update booking status error:", error);
    res.status(500).json({ error: "Failed to update booking" });
  }
};

/**
 * Get barber's studio services
 * GET /api/studios/manage/services
 */
export const getBarberServices = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const result = await pool.query(
      `SELECT * FROM services WHERE studio_id = $1 ORDER BY category, price`,
      [studioId]
    );

    // Group by category
    const grouped = {};
    result.rows.forEach(service => {
      if (!grouped[service.category]) {
        grouped[service.category] = [];
      }
      grouped[service.category].push(service);
    });

    res.json({ services: result.rows, grouped });
  } catch (error) {
    console.error("Get barber services error:", error);
    res.status(500).json({ error: "Failed to fetch services" });
  }
};

/**
 * Create or update service
 * POST /api/studios/manage/services
 */
export const createService = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { name, description, category, price, duration, imageUrl } = req.body;

    if (!name || !price || !duration) {
      return res.status(400).json({ error: "Name, price, and duration required" });
    }

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const result = await pool.query(
      `INSERT INTO services (id, studio_id, name, description, category, price, duration, image_url)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [studioId, name, description || '', category || 'General', price, duration, imageUrl || null]
    );

    res.status(201).json({ service: result.rows[0] });
  } catch (error) {
    console.error("Create service error:", error);
    res.status(500).json({ error: "Failed to create service" });
  }
};

/**
 * Update service
 * PUT /api/studios/manage/services/:id
 */
export const updateService = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { id } = req.params;
    const { name, description, category, price, duration, imageUrl, isActive } = req.body;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const service = await pool.query(
      `SELECT * FROM services WHERE id = $1 AND studio_id = $2`,
      [id, studioId]
    );

    if (service.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    const result = await pool.query(
      `UPDATE services 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           category = COALESCE($3, category),
           price = COALESCE($4, price),
           duration = COALESCE($5, duration),
           image_url = COALESCE($6, image_url),
           is_active = COALESCE($7, is_active)
       WHERE id = $8
       RETURNING *`,
      [name, description, category, price, duration, imageUrl, isActive, id]
    );

    res.json({ service: result.rows[0] });
  } catch (error) {
    console.error("Update service error:", error);
    res.status(500).json({ error: "Failed to update service" });
  }
};

/**
 * Delete service
 * DELETE /api/studios/manage/services/:id
 */
export const deleteService = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { id } = req.params;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const result = await pool.query(
      `DELETE FROM services WHERE id = $1 AND studio_id = $2 RETURNING id`,
      [id, studioId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Service not found" });
    }

    res.json({ message: "Service deleted" });
  } catch (error) {
    console.error("Delete service error:", error);
    res.status(500).json({ error: "Failed to delete service" });
  }
};

/**
 * Get team members (barbers in same studio)
 * GET /api/studios/manage/team
 */
export const getTeamMembers = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);

    if (!studioId) {
      return res.json({ barbers: [] });
    }

    const result = await pool.query(
      `SELECT 
        b.id, b.name, b.email, b.phone, b.title, b.image_url,
        b.experience_years, b.specialties, b.rating, b.is_active,
        COUNT(CASE WHEN bk.status NOT IN ('cancelled', 'completed') 
              AND bk.appointment_date = CURRENT_DATE THEN 1 END) as today_bookings,
        MIN(CASE WHEN bk.status NOT IN ('cancelled', 'completed') 
            AND bk.appointment_date >= CURRENT_DATE 
            AND (bk.appointment_date > CURRENT_DATE OR bk.appointment_time > CURRENT_TIME)
            THEN bk.appointment_time END) as next_available
       FROM barbers b
       LEFT JOIN bookings bk ON b.id = bk.barber_id
       WHERE b.studio_id = $1 AND b.is_active = true
       GROUP BY b.id
       ORDER BY b.name`,
      [studioId]
    );

    res.json({ barbers: result.rows });
  } catch (error) {
    console.error("Get team members error:", error);
    res.status(500).json({ error: "Failed to fetch team members" });
  }
};

/**
 * Get barber analytics
 * GET /api/studios/manage/analytics
 */
export const getBarberAnalytics = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { period = 'month' } = req.query;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    let dateFilter;
    const now = new Date();
    
    switch (period) {
      case 'week':
        dateFilter = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'quarter':
        dateFilter = new Date(now.setMonth(now.getMonth() - 3));
        break;
      case 'year':
        dateFilter = new Date(now.setFullYear(now.getFullYear() - 1));
        break;
      default: // month
        dateFilter = new Date(now.setMonth(now.getMonth() - 1));
    }

    // Total revenue and bookings
    const totals = await pool.query(
      `SELECT 
        COUNT(*) as total_bookings,
        COALESCE(SUM(total_price), 0) as total_revenue,
        COALESCE(AVG(total_price), 0) as avg_ticket
       FROM bookings
       WHERE studio_id = $1 
        AND appointment_date >= $2
        AND status = 'completed'`,
      [studioId, dateFilter.toISOString().split('T')[0]]
    );

    // Top services
    const topServices = await pool.query(
      `SELECT 
        sv.name,
        COUNT(*) as bookings,
        SUM(bs.price) as revenue
       FROM booking_services bs
       JOIN services sv ON bs.service_id = sv.id
       JOIN bookings b ON bs.booking_id = b.id
       WHERE b.studio_id = $1 
        AND b.appointment_date >= $2
        AND b.status = 'completed'
        GROUP BY sv.id
        ORDER BY revenue DESC
        LIMIT 5`,
      [studioId, dateFilter.toISOString().split('T')[0]]
    );

    // Revenue by month
    const revenueByMonth = await pool.query(
      `SELECT 
        TO_CHAR(appointment_date, 'Mon') as month,
        EXTRACT(MONTH FROM appointment_date) as month_num,
        COALESCE(SUM(total_price), 0) as revenue
       FROM bookings
       WHERE studio_id = $1 
        AND appointment_date >= $2
        AND status = 'completed'
        GROUP BY month, month_num
        ORDER BY month_num`,
      [studioId, dateFilter.toISOString().split('T')[0]]
    );

    // Peak hours
    const peakHours = await pool.query(
      `SELECT 
        EXTRACT(HOUR FROM appointment_time) as hour,
        COUNT(*) as bookings
       FROM bookings
       WHERE studio_id = $1 
        AND appointment_date >= $2
        AND status NOT IN ('cancelled')
        GROUP BY hour
        ORDER BY hour`,
      [studioId, dateFilter.toISOString().split('T')[0]]
    );

    // Get reviews stats
    const reviews = await pool.query(
      `SELECT 
        COUNT(*) as total_reviews,
        COALESCE(AVG(rating), 0) as avg_rating
       FROM reviews
       WHERE studio_id = $1
        AND created_at >= $2`,
      [studioId, dateFilter.toISOString()]
    );

    res.json({
      period,
      totals: {
        revenue: parseFloat(totals.rows[0].total_revenue),
        bookings: parseInt(totals.rows[0].total_bookings),
        avgTicket: parseFloat(totals.rows[0].avg_ticket).toFixed(2),
        reviews: parseInt(reviews.rows[0].total_reviews),
        avgRating: parseFloat(reviews.rows[0].avg_rating).toFixed(1)
      },
      topServices: topServices.rows,
      revenueByMonth: revenueByMonth.rows,
      peakHours: peakHours.rows
    });
  } catch (error) {
    console.error("Get barber analytics error:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
};

/**
 * Get studio settings (working hours, etc.)
 * GET /api/studios/manage/studio
 * GET /api/studio/settings
 */
export const getStudioSettings = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const [profileResult, studioResult, hoursResult, barbersResult] =
      await Promise.all([
        pool.query(
          `SELECT id, name, email, phone, image_url
           FROM studio_owners
           WHERE studio_id = $1
           ORDER BY id ASC
           LIMIT 1`,
          [studioId]
        ),
        pool.query(
          `SELECT
             id, name, description, address, city, state, zip_code, country,
             phone, email, image_url, logo_url, banner_url,
             amenities, lat, lng, is_active, updated_at
           FROM studios
           WHERE id = $1`,
          [studioId]
        ),
        pool.query(
          `SELECT * FROM studio_hours WHERE studio_id = $1 ORDER BY day_of_week`,
          [studioId]
        ),
        pool.query(
          `SELECT id, name, email, phone, title, specialties, image_url, is_active
           FROM barbers
           WHERE studio_id = $1
           ORDER BY created_at ASC`,
          [studioId]
        ),
      ]);

    if (!profileResult.rows[0]) {
      return res.status(404).json({ error: "Studio owner not found" });
    }

    res.json({
      barber: profileResult.rows[0],
      studio: studioResult.rows[0] || null,
      workingHours: hoursResult.rows,
      barbers: barbersResult.rows,
    });
  } catch (error) {
    console.error("Get studio settings error:", error);
    res.status(500).json({ error: "Failed to fetch settings" });
  }
};

/**
 * Update studio settings
 * PUT /api/studios/manage/studio
 * PUT /api/studio/settings
 */
export const updateStudioSettings = async (req, res) => {
  const client = await pool.connect();

  try {
    const studioId = getStudioId(req.user);
    const {
      name,
      description,
      address,
      city,
      state,
      zipCode,
      zip_code,
      country,
      phone,
      email,
      amenities,
      lat,
      lng,
      imageUrl,
      logoUrl,
      bannerUrl,
      banner_url,
      image_url,
      logo_url,
      workingHours,
      working_hours,
    } = req.body;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const resolvedZipCode = zipCode ?? zip_code;
    const resolvedLogoUrl = logo_url ?? logoUrl ?? image_url ?? imageUrl;
    const resolvedBannerUrl = banner_url ?? bannerUrl;
    const resolvedImageUrl = image_url ?? imageUrl ?? resolvedLogoUrl;

    let resolvedAmenities;
    if (amenities !== undefined) {
      if (Array.isArray(amenities)) {
        resolvedAmenities = amenities;
      } else if (typeof amenities === "string") {
        try {
          const parsed = JSON.parse(amenities);
          if (!Array.isArray(parsed)) {
            return res.status(400).json({ error: "amenities must be an array" });
          }
          resolvedAmenities = parsed;
        } catch {
          return res.status(400).json({ error: "amenities must be valid JSON array" });
        }
      } else {
        return res.status(400).json({ error: "amenities must be an array" });
      }
    }

    const resolvedLat =
      lat === undefined || lat === null || lat === "" ? undefined : Number(lat);
    const resolvedLng =
      lng === undefined || lng === null || lng === "" ? undefined : Number(lng);

    if (resolvedLat !== undefined && !Number.isFinite(resolvedLat)) {
      return res.status(400).json({ error: "lat must be a valid number" });
    }
    if (resolvedLng !== undefined && !Number.isFinite(resolvedLng)) {
      return res.status(400).json({ error: "lng must be a valid number" });
    }

    const hoursPayload = Array.isArray(workingHours)
      ? workingHours
      : Array.isArray(working_hours)
      ? working_hours
      : undefined;

    const normalizedHours = [];
    if (Array.isArray(hoursPayload)) {
      for (const hours of hoursPayload) {
        const dayOfWeekRaw = hours.dayOfWeek ?? hours.day_of_week;
        const dayOfWeek = Number(dayOfWeekRaw);
        const openTime = hours.openTime ?? hours.open_time ?? null;
        const closeTime = hours.closeTime ?? hours.close_time ?? null;
        const isClosed = Boolean(hours.isClosed ?? hours.is_closed ?? false);

        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
          return res.status(400).json({ error: "dayOfWeek must be an integer from 0 to 6" });
        }

        if (!isClosed) {
          if (!openTime || !closeTime) {
            return res.status(400).json({ error: "openTime and closeTime are required for open days" });
          }
          if (!TIME_VALUE_REGEX.test(openTime) || !TIME_VALUE_REGEX.test(closeTime)) {
            return res.status(400).json({ error: "openTime and closeTime must be in HH:MM or HH:MM:SS format" });
          }
        }

        normalizedHours.push({
          dayOfWeek,
          openTime: isClosed ? null : openTime,
          closeTime: isClosed ? null : closeTime,
          isClosed,
        });
      }
    }

    await client.query("BEGIN");
    await client.query(
      `UPDATE studios
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           address = COALESCE($3, address),
           city = COALESCE($4, city),
           state = COALESCE($5, state),
           zip_code = COALESCE($6, zip_code),
           country = COALESCE($7, country),
           phone = COALESCE($8, phone),
           email = COALESCE($9, email),
           image_url = COALESCE($10, image_url),
           logo_url = COALESCE($11, logo_url),
           banner_url = COALESCE($12, banner_url),
           amenities = COALESCE($13::jsonb, amenities),
           lat = COALESCE($14, lat),
           lng = COALESCE($15, lng),
           updated_at = NOW()
       WHERE id = $16`,
      [
        name ?? null,
        description ?? null,
        address ?? null,
        city ?? null,
        state ?? null,
        resolvedZipCode ?? null,
        country ?? null,
        phone ?? null,
        email ?? null,
        resolvedImageUrl ?? null,
        resolvedLogoUrl ?? null,
        resolvedBannerUrl ?? null,
        resolvedAmenities !== undefined ? JSON.stringify(resolvedAmenities) : null,
        resolvedLat ?? null,
        resolvedLng ?? null,
        studioId,
      ]
    );

    if (normalizedHours.length > 0) {
      for (const hours of normalizedHours) {
        const updateResult = await client.query(
          `UPDATE studio_hours
           SET open_time = $3,
               close_time = $4,
               is_closed = $5,
               updated_at = NOW()
           WHERE studio_id = $1 AND day_of_week = $2`,
          [
            studioId,
            hours.dayOfWeek,
            hours.openTime,
            hours.closeTime,
            hours.isClosed,
          ]
        );

        if (updateResult.rowCount === 0) {
          await client.query(
            `INSERT INTO studio_hours (id, studio_id, day_of_week, open_time, close_time, is_closed)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
            [
              studioId,
              hours.dayOfWeek,
              hours.openTime,
              hours.closeTime,
              hours.isClosed,
            ]
          );
        }
      }
    }

    await client.query("COMMIT");
    res.json({ message: "Settings updated successfully" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Update studio settings error:", error);
    res.status(500).json({ error: "Failed to update settings" });
  } finally {
    client.release();
  }
};

/**
 * Create walk-in booking
 * POST /api/studios/manage/walk-in
 */
export const createWalkInBooking = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { customerPhone, customerName, serviceIds, notes } = req.body;

    if (!serviceIds?.length) {
      return res.status(400).json({ error: "At least one service required" });
    }

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const defaultTeamMember = await pool.query(
      `SELECT id FROM barbers WHERE studio_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
      [studioId]
    );
    const assignedTeamMemberId = defaultTeamMember.rows[0]?.id || null;

    // Calculate totals from services
    const services = await pool.query(
      `SELECT id, price, duration FROM services WHERE id = ANY($1) AND studio_id = $2`,
      [serviceIds, studioId]
    );

    if (services.rows.length !== serviceIds.length) {
      return res.status(400).json({ error: "Invalid services" });
    }

    const totalPrice = services.rows.reduce((sum, s) => sum + parseFloat(s.price), 0);
    const totalDuration = services.rows.reduce((sum, s) => sum + s.duration, 0);

    // Get or create guest user
    let userId = null;
    if (customerPhone) {
      const existingUser = await pool.query(
        `SELECT id FROM users WHERE phone = $1`,
        [customerPhone]
      );
      
      if (existingUser.rows.length > 0) {
        userId = existingUser.rows[0].id;
      }
    }

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0].slice(0, 5);

    const normalizedStartTime = currentTime.length === 5 ? `${currentTime}:00` : currentTime;
    const endMinutes = totalDuration || 0;
    const [startHourRaw = "0", startMinuteRaw = "0"] = normalizedStartTime.split(":");
    const totalStartMinutes = Number(startHourRaw) * 60 + Number(startMinuteRaw) + Number(endMinutes);
    const normalizedEndMinutes = ((totalStartMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
    const endHour = Math.floor(normalizedEndMinutes / 60);
    const endMinute = normalizedEndMinutes % 60;
    const calculatedEndTime = `${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}:00`;

    const [bookingsHasIntegerId, bookingServicesHasIntegerId] = await Promise.all([
      tableHasIntegerId(pool, "bookings"),
      tableHasIntegerId(pool, "booking_services"),
    ]);

    // Create booking
    const walkInInsertParams = [
      userId,
      studioId,
      assignedTeamMemberId,
      today,
      normalizedStartTime,
      calculatedEndTime,
      today,
      normalizedStartTime,
      totalPrice,
      totalPrice,
      totalDuration,
      notes || `Walk-in: ${customerName || "Guest"} - ${customerPhone || "No phone"}`
    ];

    const walkInInsertQuery = bookingsHasIntegerId
      ? `INSERT INTO bookings
         (user_id, studio_id, barber_id, booking_date, start_time, end_time,
          appointment_date, appointment_time, total_amount, total_price, total_duration,
          notes, status, payment_status, payment_method, created_at)
         VALUES ($1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, 'confirmed', 'pending', 'cash', NOW())
         RETURNING *`
      : `INSERT INTO bookings
         (id, user_id, studio_id, barber_id, booking_date, start_time, end_time,
          appointment_date, appointment_time, total_amount, total_price, total_duration,
          notes, status, payment_status, payment_method, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6,
                 $7, $8, $9, $10, $11,
                 $12, 'confirmed', 'pending', 'cash', NOW())
         RETURNING *`;

    const result = await pool.query(walkInInsertQuery, walkInInsertParams);

    const bookingId = result.rows[0].id;
    const bookingServicesInsertQuery = bookingServicesHasIntegerId
      ? `INSERT INTO booking_services (booking_id, service_id, price, duration)
         VALUES ($1, $2, $3, $4)`
      : `INSERT INTO booking_services (id, booking_id, service_id, price, duration)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`;

    // Insert booking services
    for (const serviceId of serviceIds) {
      const service = services.rows.find(s => s.id === serviceId);
      await pool.query(
        bookingServicesInsertQuery,
        [bookingId, serviceId, service.price, service.duration]
      );
    }

    // Generate confirmation code
    const confirmationCode = `WLK-${Date.now().toString(36).toUpperCase()}`;
    await pool.query(
      `UPDATE bookings SET confirmation_code = $1 WHERE id = $2`,
      [confirmationCode, bookingId]
    );

    res.status(201).json({
      message: "Walk-in booking created",
      booking: {
        ...result.rows[0],
        confirmationCode,
        services: services.rows,
        customerName,
        customerPhone
      }
    });
  } catch (error) {
    console.error("Create walk-in error:", error);
    res.status(500).json({ error: "Failed to create walk-in booking" });
  }
};

/**
 * Get barber's payments/transactions
 * GET /api/studios/manage/payments
 */
export const getBarberPayments = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { status, page = 1, limit = 20 } = req.query;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    // Build query - get completed bookings as transactions
    let query = `
      SELECT 
        b.id,
        b.total_price as amount,
        b.payment_status,
        b.payment_method,
        b.status as booking_status,
        b.appointment_date,
        b.appointment_time,
        b.created_at,
        u.name as customer_name,
        u.avatar_url as customer_image,
        COALESCE(
          (SELECT string_agg(s.name, ', ') 
           FROM booking_services bs 
           JOIN services s ON bs.service_id = s.id 
           WHERE bs.booking_id = b.id),
          'Walk-in Service'
        ) as services
      FROM bookings b
      LEFT JOIN users u ON b.user_id = u.id
      WHERE b.studio_id = $1
    `;

    const params = [studioId];
    let paramCount = 1;

    // Filter by payment status
    if (status && status !== 'all') {
      paramCount++;
      query += ` AND b.payment_status = $${paramCount}`;
      params.push(status);
    }

    query += ` ORDER BY b.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(Number(limit), (Number(page) - 1) * Number(limit));

    const result = await pool.query(query, params);

    // Get summary stats
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    // This month revenue
    const thisMonthStats = await pool.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN total_price ELSE 0 END), 0) as total_paid,
        COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN total_price ELSE 0 END), 0) as total_pending
       FROM bookings
       WHERE studio_id = $1
        AND appointment_date >= $2
        AND status != 'cancelled'`,
      [studioId, monthStart.toISOString().split('T')[0]]
    );

    // Last month revenue for comparison
    const lastMonthStats = await pool.query(
      `SELECT COALESCE(SUM(total_price), 0) as total
       FROM bookings
       WHERE studio_id = $1
        AND appointment_date >= $2
        AND appointment_date <= $3
        AND status = 'completed'
        AND payment_status = 'paid'`,
      [studioId, lastMonthStart.toISOString().split('T')[0], lastMonthEnd.toISOString().split('T')[0]]
    );

    // Calculate change percentage
    const thisMonthTotal = parseFloat(thisMonthStats.rows[0].total_paid);
    const lastMonthTotal = parseFloat(lastMonthStats.rows[0].total);
    const monthChange = lastMonthTotal > 0 
      ? Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
      : 0;

    // Get total counts
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM bookings WHERE studio_id = $1`,
      [studioId]
    );

    res.json({
      transactions: result.rows.map(row => ({
        id: row.id,
        amount: parseFloat(row.amount),
        paymentStatus: row.payment_status,
        paymentMethod: row.payment_method || 'card',
        bookingStatus: row.booking_status,
        customerName: row.customer_name || 'Walk-in Guest',
        customerImage: row.customer_image,
        services: row.services,
        date: row.appointment_date,
        time: row.appointment_time,
        createdAt: row.created_at
      })),
      summary: {
        availableBalance: parseFloat(thisMonthStats.rows[0].total_paid),
        pendingClearance: parseFloat(thisMonthStats.rows[0].total_pending),
        thisMonth: thisMonthTotal,
        monthChange
      },
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: parseInt(countResult.rows[0].total)
      }
    });
  } catch (error) {
    console.error("Get barber payments error:", error);
    res.status(500).json({ error: "Failed to fetch payments" });
  }
};

/**
 * Update payment status
 * PATCH /api/studios/manage/payments/:id
 */
export const updatePaymentStatus = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { id } = req.params;
    const { paymentStatus, paymentMethod } = req.body;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    // Verify booking belongs to this studio
    const booking = await pool.query(
      `SELECT id FROM bookings WHERE id = $1 AND studio_id = $2`,
      [id, studioId]
    );

    if (booking.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    // Update payment status
    const result = await pool.query(
      `UPDATE bookings 
       SET payment_status = COALESCE($1, payment_status),
           payment_method = COALESCE($2, payment_method),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [paymentStatus, paymentMethod, id]
    );

    res.json({
      message: "Payment status updated",
      booking: result.rows[0]
    });
  } catch (error) {
    console.error("Update payment status error:", error);
    res.status(500).json({ error: "Failed to update payment status" });
  }
};

/**
 * Get barber's reviews
 * GET /api/studios/manage/reviews
 */
export const getBarberReviewsForDashboard = async (req, res) => {
  try {
    const studioId = getStudioId(req.user);
    const { page = 1, limit = 10 } = req.query;

    if (!studioId) {
      return res.status(400).json({ error: "No studio associated" });
    }

    const result = await pool.query(
      `SELECT 
        r.*,
        u.name as customer_name,
        u.avatar_url as customer_image
       FROM reviews r
       JOIN users u ON r.user_id = u.id
       WHERE r.studio_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2 OFFSET $3`,
      [studioId, limit, (page - 1) * limit]
    );

    const stats = await pool.query(
      `SELECT 
        COUNT(*) as total,
        AVG(rating) as avg_rating,
        COUNT(CASE WHEN rating = 5 THEN 1 END) as five_star,
        COUNT(CASE WHEN rating = 4 THEN 1 END) as four_star,
        COUNT(CASE WHEN rating = 3 THEN 1 END) as three_star,
        COUNT(CASE WHEN rating = 2 THEN 1 END) as two_star,
        COUNT(CASE WHEN rating = 1 THEN 1 END) as one_star
       FROM reviews WHERE studio_id = $1`,
      [studioId]
    );

    res.json({
      reviews: result.rows,
      stats: {
        total: parseInt(stats.rows[0].total),
        avgRating: parseFloat(stats.rows[0].avg_rating || 0).toFixed(1),
        distribution: {
          5: parseInt(stats.rows[0].five_star),
          4: parseInt(stats.rows[0].four_star),
          3: parseInt(stats.rows[0].three_star),
          2: parseInt(stats.rows[0].two_star),
          1: parseInt(stats.rows[0].one_star)
        }
      },
      pagination: {
        page: Number(page),
        limit: Number(limit)
      }
    });
  } catch (error) {
    console.error("Get barber reviews error:", error);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
};
