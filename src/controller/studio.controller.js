import pool from "../config/db.js";

/**
 * Get all studios with filtering
 * GET /api/studios
 */
export const getStudios = async (req, res) => {
  try {
    const { 
      search, 
      lat, 
      lng, 
      radius = 10, // km
      rating,
      sortBy = "rating",
      page = 1, 
      limit = 20 
    } = req.query;

    let query = `
      SELECT
        s.*,
        COUNT(DISTINCT b.id) as total_bookings,
        json_agg(DISTINCT jsonb_build_object(
          'id', br.id,
          'name', br.name,
          'image_url', br.image_url,
          'rating', br.rating
        )) FILTER (WHERE br.id IS NOT NULL) as barbers
      FROM studios s
      LEFT JOIN bookings b ON s.id = b.studio_id
      LEFT JOIN barbers br ON br.studio_id = s.id AND br.is_active = true
      WHERE s.is_active = true
    `;

    const params = [];

    // Search filter
    if (search) {
      params.push(`%${search}%`);
      query += ` AND (s.name ILIKE $${params.length} OR s.address ILIKE $${params.length})`;
    }

    // Location filter (using Haversine formula approximation)
    if (lat && lng) {
      params.push(lat, lng, radius);
      query += `
        AND (
          6371 * acos(
            cos(radians($${params.length - 2})) * cos(radians(s.lat)) *
            cos(radians(s.lng) - radians($${params.length - 1})) +
            sin(radians($${params.length - 2})) * sin(radians(s.lat))
          )
        ) <= $${params.length}
      `;
    }

    // Rating filter
    if (rating) {
      params.push(rating);
      query += ` AND s.rating >= $${params.length}`;
    }

    query += ` GROUP BY s.id`;

    // Sorting
    switch (sortBy) {
      case "distance":
        if (lat && lng) {
          query += ` ORDER BY (
            6371 * acos(
              cos(radians(${lat})) * cos(radians(s.lat)) *
              cos(radians(s.lng) - radians(${lng})) +
              sin(radians(${lat})) * sin(radians(s.lat))
            )
          ) ASC`;
        }
        break;
      case "reviews":
        query += ` ORDER BY s.review_count DESC NULLS LAST`;
        break;
      case "name":
        query += ` ORDER BY s.name ASC`;
        break;
      default:
        query += ` ORDER BY s.rating DESC NULLS LAST`;
    }

    params.push(limit, (page - 1) * limit);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Get total count
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM studios WHERE is_active = true`
    );

    res.json({
      studios: result.rows,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error("Get studios error:", error);
    res.status(500).json({ error: "Failed to fetch studios" });
  }
};

/**
 * Get studio details
 * GET /api/studios/:id
 */
export const getStudioById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT
        s.*,
        json_agg(DISTINCT jsonb_build_object(
          'id', br.id,
          'name', br.name,
          'title', br.title,
          'image_url', br.image_url,
          'rating', br.rating,
          'experience_years', br.experience_years,
          'specialties', br.specialties
        )) FILTER (WHERE br.id IS NOT NULL) as barbers,
        json_agg(DISTINCT jsonb_build_object(
          'id', sv.id,
          'name', sv.name,
          'description', sv.description,
          'price', sv.price,
          'duration', sv.duration,
          'category', sv.category
        )) FILTER (WHERE sv.id IS NOT NULL) as services
      FROM studios s
      LEFT JOIN barbers br ON br.studio_id = s.id AND br.is_active = true
      LEFT JOIN services sv ON sv.studio_id = s.id AND sv.is_active = true
      WHERE s.id = $1 AND s.is_active = true
      GROUP BY s.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Studio not found" });
    }

    // Get recent reviews
    const reviews = await pool.query(
      `SELECT 
        r.*,
        u.name as user_name,
        u.avatar_url as user_avatar
      FROM reviews r
      JOIN users u ON r.user_id = u.id
      WHERE r.studio_id = $1
      ORDER BY r.created_at DESC
      LIMIT 5`,
      [id]
    );

    // Get working hours
    const hours = await pool.query(
      `SELECT * FROM studio_hours WHERE studio_id = $1 ORDER BY day_of_week`,
      [id]
    );

    res.json({
      studio: {
        ...result.rows[0],
        reviews: reviews.rows,
        workingHours: hours.rows
      }
    });
  } catch (error) {
    console.error("Get studio error:", error);
    res.status(500).json({ error: "Failed to fetch studio" });
  }
};

/**
 * Get studio services
 * GET /api/studios/:id/services
 */
export const getStudioServices = async (req, res) => {
  try {
    const { id } = req.params;
    const { category } = req.query;

    let query = `
      SELECT id, name, description, price, duration, category, image_url, is_active
      FROM services 
      WHERE studio_id = $1 AND is_active = true
    `;
    const params = [id];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    query += ` ORDER BY category, price ASC`;

    const result = await pool.query(query, params);

    res.json({ services: result.rows });
  } catch (error) {
    console.error("Get studio services error:", error);
    res.status(500).json({ error: "Failed to fetch services" });
  }
};

/**
 * Get studio barbers
 * GET /api/studios/:id/barbers
 */
export const getStudioBarbers = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT 
        br.*,
        AVG(r.rating) as avg_rating,
        COUNT(r.id) as review_count,
        COUNT(DISTINCT b.id) as total_bookings
      FROM barbers br
      LEFT JOIN reviews r ON r.barber_id = br.id
      LEFT JOIN bookings b ON b.barber_id = br.id AND b.status = 'completed'
      WHERE br.studio_id = $1 AND br.is_active = true
      GROUP BY br.id
      ORDER BY br.rating DESC`,
      [id]
    );

    res.json({ barbers: result.rows });
  } catch (error) {
    console.error("Get studio barbers error:", error);
    res.status(500).json({ error: "Failed to fetch barbers" });
  }
};

/**
 * Get studios for map display
 * GET /api/studios/map
 * Returns optimized data for map pins with location coordinates
 */
export const getStudiosForMap = async (req, res) => {
  try {
    const { 
      lat, 
      lng, 
      radius = 25, // km - default 25km radius
      minLat,
      maxLat,
      minLng,
      maxLng,
      limit = 50 
    } = req.query;

    let query = `
      SELECT 
        s.id,
        s.name,
        s.lat,
        s.lng,
        s.address,
        s.city,
        s.state,
        s.rating,
        s.review_count,
        s.image_url,
        s.amenities,
        (
          SELECT json_agg(jsonb_build_object('day', day_of_week, 'open', open_time, 'close', close_time, 'closed', is_closed))
          FROM studio_hours WHERE studio_id = s.id
        ) as hours
    `;

    const params = [];

    // Add distance calculation if user location provided
    if (lat && lng) {
      query += `,
        ROUND(
          (6371 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians($1)) * cos(radians(s.lat)) *
              cos(radians(s.lng) - radians($2)) +
              sin(radians($1)) * sin(radians(s.lat))
            ))
          ))::numeric, 1
        ) as distance_km
      `;
      params.push(lat, lng);
    }

    query += ` FROM studios s
               WHERE s.is_active = true
                 AND s.lat IS NOT NULL
                 AND s.lng IS NOT NULL`;

    // Filter by bounding box (for map viewport)
    if (minLat && maxLat && minLng && maxLng) {
      params.push(minLat, maxLat, minLng, maxLng);
      query += ` AND s.lat BETWEEN $${params.length - 3} AND $${params.length - 2}
                 AND s.lng BETWEEN $${params.length - 1} AND $${params.length}`;
    }
    // Or filter by radius from user location
    else if (lat && lng) {
      params.push(radius);
      query += `
        AND (
          6371 * acos(
            LEAST(1, GREATEST(-1,
              cos(radians($1)) * cos(radians(s.lat)) *
              cos(radians(s.lng) - radians($2)) +
              sin(radians($1)) * sin(radians(s.lat))
            ))
          )
        ) <= $${params.length}
      `;
    }

    // Order by distance if location provided, otherwise by rating
    if (lat && lng) {
      query += ` ORDER BY distance_km ASC NULLS LAST`;
    } else {
      query += ` ORDER BY s.rating DESC NULLS LAST`;
    }

    params.push(limit);
    query += ` LIMIT $${params.length}`;

    const result = await pool.query(query, params);

    // Calculate if each studio is currently open
    const now = new Date();
    const currentDay = now.getDay(); // 0 = Sunday
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"

    const studiosWithStatus = result.rows.map(studio => {
      let isOpen = false;
      let nextOpen = null;

      if (studio.hours) {
        const todayHours = studio.hours.find(h => h.day === currentDay);
        if (todayHours && !todayHours.closed && todayHours.open && todayHours.close) {
          const openTime = todayHours.open.slice(0, 5);
          const closeTime = todayHours.close.slice(0, 5);
          isOpen = currentTime >= openTime && currentTime < closeTime;
          if (!isOpen && currentTime < openTime) {
            nextOpen = openTime;
          }
        }
        
        // Find next opening time if closed today
        if (!isOpen && !nextOpen) {
          for (let i = 1; i <= 7; i++) {
            const checkDay = (currentDay + i) % 7;
            const dayHours = studio.hours.find(h => h.day === checkDay);
            if (dayHours && !dayHours.closed && dayHours.open) {
              nextOpen = `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][checkDay]} ${dayHours.open.slice(0, 5)}`;
              break;
            }
          }
        }
      }

      return {
        ...studio,
        is_open: isOpen,
        next_open: nextOpen,
        hours: undefined // Remove raw hours from response
      };
    });

    res.json({
      studios: studiosWithStatus,
      center: lat && lng ? { lat: Number(lat), lng: Number(lng) } : null,
      count: studiosWithStatus.length
    });
  } catch (error) {
    console.error("Get studios for map error:", error);
    res.status(500).json({ error: "Failed to fetch studios for map" });
  }
};
