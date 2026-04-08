import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

/**
 * Geocode an address using OpenStreetMap Nominatim (free, no API key needed)
 * Falls back to simpler queries if full address doesn't match
 */
async function geocodeAddress(address, city, state, country = "India") {
  const attempts = [
    // Try full address first
    [address, city, state, country].filter(Boolean).join(", "),
    // Try without street address (just city, state, country)
    [city, state, country].filter(Boolean).join(", "),
    // Try just city and country
    [city, country].filter(Boolean).join(", "),
  ];

  for (const query of attempts) {
    if (!query.trim()) continue;
    
    try {
      const encodedAddress = encodeURIComponent(query);
      console.log("Geocoding attempt:", query);
      
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1`,
        {
          headers: {
            "User-Agent": "SnapCut-App/1.0 (https://snapcut.com; admin@snapcut.com)",
            "Accept": "application/json",
            "Accept-Language": "en"
          }
        }
      );
      
      if (!response.ok) {
        console.error("Geocoding HTTP error:", response.status);
        continue;
      }
      
      const data = await response.json();
      console.log("Geocoding result:", data);
      
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          displayName: data[0].display_name
        };
      }
      
      // Add a small delay between attempts to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Geocoding error for query:", query, error);
    }
  }
  
  return null;
}

/**
 * Log admin activity
 */
async function logAdminActivity(adminId, action, entityType, entityId, details, ipAddress) {
  try {
    await pool.query(
      `INSERT INTO admin_activity_log (admin_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [adminId, action, entityType, entityId, JSON.stringify(details), ipAddress]
    );
  } catch (error) {
    console.error("Failed to log admin activity:", error);
  }
}

// ==========================================
// Admin Authentication
// ==========================================

/**
 * Admin Login
 * POST /api/admin/login
 */
export const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const result = await pool.query(
      "SELECT * FROM admins WHERE email = $1",
      [email]
    );

    const admin = result.rows[0];

    if (!admin) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, admin.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (!admin.is_active) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    // Update last login
    await pool.query(
      "UPDATE admins SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
      [admin.id]
    );

    const token = jwt.sign(
      { id: admin.id, role: admin.role },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    await logAdminActivity(admin.id, "login", "admin", admin.id, {}, req.ip);

    res.json({
      token,
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

/**
 * Get current admin profile
 * GET /api/admin/me
 */
export const getAdminProfile = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, role, last_login, created_at FROM admins WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Admin not found" });
    }

    res.json({ admin: result.rows[0] });
  } catch (error) {
    console.error("Get admin profile error:", error);
    res.status(500).json({ error: "Failed to get profile" });
  }
};

// ==========================================
// Dashboard Statistics
// ==========================================

/**
 * Get dashboard statistics
 * GET /api/admin/dashboard
 */
export const getDashboardStats = async (req, res) => {
  try {
    // Get counts
    const [
      studioStats,
      userCount,
      bookingStats,
      recentStudios,
      recentActivity
    ] = await Promise.all([
      // Studio counts by status
      pool.query(`
        SELECT 
          COUNT(*) FILTER (WHERE approval_status = 'pending') as pending,
          COUNT(*) FILTER (WHERE approval_status = 'approved') as approved,
          COUNT(*) FILTER (WHERE approval_status = 'rejected') as rejected,
          COUNT(*) FILTER (WHERE approval_status = 'suspended') as suspended,
          COUNT(*) as total
        FROM studios
      `),
      // User count
      pool.query("SELECT COUNT(*) as total FROM users WHERE is_active = true"),
      // Booking stats
      pool.query(`
        SELECT 
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'pending' OR status = 'confirmed') as upcoming,
          COALESCE(SUM(total_amount) FILTER (WHERE status = 'completed'), 0) as revenue
        FROM bookings
        WHERE booking_date >= CURRENT_DATE - INTERVAL '30 days'
      `),
      // Recent pending studios
      pool.query(`
        SELECT id, name, city, state, created_at 
        FROM studios 
        WHERE approval_status = 'pending'
        ORDER BY created_at DESC 
        LIMIT 5
      `),
      // Recent admin activity
      pool.query(`
        SELECT al.*, a.name as admin_name
        FROM admin_activity_log al
        LEFT JOIN admins a ON al.admin_id = a.id
        ORDER BY al.created_at DESC
        LIMIT 10
      `)
    ]);

    res.json({
      studios: studioStats.rows[0],
      users: { total: parseInt(userCount.rows[0].total) },
      bookings: {
        total: parseInt(bookingStats.rows[0].total),
        completed: parseInt(bookingStats.rows[0].completed),
        upcoming: parseInt(bookingStats.rows[0].upcoming),
        revenue: parseFloat(bookingStats.rows[0].revenue) || 0
      },
      recentPendingStudios: recentStudios.rows,
      recentActivity: recentActivity.rows
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Failed to get dashboard stats" });
  }
};

// ==========================================
// Studio Management
// ==========================================

/**
 * Get all studios with filtering
 * GET /api/admin/studios
 */
export const getAdminStudios = async (req, res) => {
  try {
    const { 
      status, 
      search, 
      page = 1, 
      limit = 20,
      sortBy = "created_at",
      sortOrder = "desc"
    } = req.query;

    let query = `
      SELECT 
        s.*,
        so.name as owner_name,
        so.email as owner_email,
        so.phone as owner_phone,
        COUNT(DISTINCT b.id) as booking_count,
        COUNT(DISTINCT br.id) as barber_count
      FROM studios s
      LEFT JOIN studio_owners so ON so.studio_id = s.id
      LEFT JOIN bookings b ON b.studio_id = s.id
      LEFT JOIN barbers br ON br.studio_id = s.id AND br.is_active = true
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      params.push(status);
      query += ` AND s.approval_status = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (s.name ILIKE $${params.length} OR s.city ILIKE $${params.length} OR so.email ILIKE $${params.length})`;
    }

    query += ` GROUP BY s.id, so.name, so.email, so.phone`;

    // Sorting
    const validSortColumns = ["created_at", "name", "rating", "approval_status"];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : "created_at";
    const order = sortOrder.toLowerCase() === "asc" ? "ASC" : "DESC";
    query += ` ORDER BY s.${sortColumn} ${order}`;

    // Pagination
    const offset = (page - 1) * limit;
    params.push(limit, offset);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(DISTINCT s.id) 
      FROM studios s
      LEFT JOIN studio_owners so ON so.studio_id = s.id
      WHERE 1=1
    `;
    const countParams = [];
    
    if (status) {
      countParams.push(status);
      countQuery += ` AND s.approval_status = $${countParams.length}`;
    }
    if (search) {
      countParams.push(`%${search}%`);
      countQuery += ` AND (s.name ILIKE $${countParams.length} OR s.city ILIKE $${countParams.length} OR so.email ILIKE $${countParams.length})`;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      studios: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error("Get admin studios error:", error);
    res.status(500).json({ error: "Failed to get studios" });
  }
};

/**
 * Get single studio details
 * GET /api/admin/studios/:id
 */
export const getAdminStudioById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT 
        s.*,
        so.id as owner_id,
        so.name as owner_name,
        so.email as owner_email,
        so.phone as owner_phone,
        so.created_at as owner_since,
        a.name as approved_by_name
      FROM studios s
      LEFT JOIN studio_owners so ON so.studio_id = s.id
      LEFT JOIN admins a ON s.approved_by = a.id
      WHERE s.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Studio not found" });
    }

    // Get barbers
    const barbers = await pool.query(
      "SELECT id, name, phone, title, is_active FROM barbers WHERE studio_id = $1",
      [id]
    );

    // Get services
    const services = await pool.query(
      "SELECT * FROM services WHERE studio_id = $1 ORDER BY category, name",
      [id]
    );

    // Get working hours
    const hours = await pool.query(
      "SELECT * FROM studio_hours WHERE studio_id = $1 ORDER BY day_of_week",
      [id]
    );

    res.json({
      studio: {
        ...result.rows[0],
        barbers: barbers.rows,
        services: services.rows,
        workingHours: hours.rows
      }
    });
  } catch (error) {
    console.error("Get admin studio error:", error);
    res.status(500).json({ error: "Failed to get studio" });
  }
};

/**
 * Update studio details
 * PUT /api/admin/studios/:id
 */
export const updateAdminStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      address,
      city,
      state,
      zip_code,
      country,
      lat,
      lng,
      phone,
      email,
      description,
      image_url,
      amenities,
      admin_notes
    } = req.body;

    // Build dynamic update query
    const updates = [];
    const params = [];
    let paramIndex = 1;

    const fields = {
      name, address, city, state, zip_code, country, lat, lng,
      phone, email, description, image_url, admin_notes
    };

    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        updates.push(`${key} = $${paramIndex}`);
        params.push(value);
        paramIndex++;
      }
    }

    if (amenities !== undefined) {
      updates.push(`amenities = $${paramIndex}`);
      params.push(JSON.stringify(amenities));
      paramIndex++;
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(id);
    const query = `
      UPDATE studios 
      SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Studio not found" });
    }

    await logAdminActivity(
      req.user.id, "update_studio", "studio", id,
      { fields: Object.keys(fields).filter(k => fields[k] !== undefined) },
      req.ip
    );

    res.json({ 
      message: "Studio updated successfully",
      studio: result.rows[0] 
    });
  } catch (error) {
    console.error("Update studio error:", error);
    res.status(500).json({ error: "Failed to update studio" });
  }
};

/**
 * Approve a studio
 * POST /api/admin/studios/:id/approve
 */
export const approveStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_notes } = req.body;

    // Check if studio exists and get its current address for geocoding
    const studioCheck = await pool.query(
      "SELECT * FROM studios WHERE id = $1",
      [id]
    );

    if (studioCheck.rows.length === 0) {
      return res.status(404).json({ error: "Studio not found" });
    }

    const studio = studioCheck.rows[0];

    // If lat/lng not set, try to geocode
    let lat = studio.lat;
    let lng = studio.lng;
    
    if (!lat || !lng) {
      const geocoded = await geocodeAddress(
        studio.address, 
        studio.city, 
        studio.state, 
        studio.country
      );
      if (geocoded) {
        lat = geocoded.lat;
        lng = geocoded.lng;
      }
    }

    const result = await pool.query(`
      UPDATE studios 
      SET 
        approval_status = 'approved',
        approved_by = $1,
        approved_at = CURRENT_TIMESTAMP,
        admin_notes = COALESCE($2, admin_notes),
        lat = COALESCE($3, lat),
        lng = COALESCE($4, lng),
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `, [req.user.id, admin_notes, lat, lng, id]);

    await logAdminActivity(
      req.user.id, "approve_studio", "studio", id,
      { previous_status: studio.approval_status, geocoded: !studio.lat && lat },
      req.ip
    );

    res.json({ 
      message: "Studio approved successfully",
      studio: result.rows[0] 
    });
  } catch (error) {
    console.error("Approve studio error:", error);
    res.status(500).json({ error: "Failed to approve studio" });
  }
};

/**
 * Reject a studio
 * POST /api/admin/studios/:id/reject
 */
export const rejectStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, admin_notes } = req.body;

    if (!reason) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }

    const result = await pool.query(`
      UPDATE studios 
      SET 
        approval_status = 'rejected',
        rejection_reason = $1,
        admin_notes = COALESCE($2, admin_notes),
        is_active = false,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `, [reason, admin_notes, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Studio not found" });
    }

    await logAdminActivity(
      req.user.id, "reject_studio", "studio", id,
      { reason },
      req.ip
    );

    res.json({ 
      message: "Studio rejected",
      studio: result.rows[0] 
    });
  } catch (error) {
    console.error("Reject studio error:", error);
    res.status(500).json({ error: "Failed to reject studio" });
  }
};

/**
 * Suspend a studio
 * POST /api/admin/studios/:id/suspend
 */
export const suspendStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, admin_notes } = req.body;

    const result = await pool.query(`
      UPDATE studios 
      SET 
        approval_status = 'suspended',
        admin_notes = COALESCE($1, admin_notes),
        is_active = false,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `, [admin_notes || reason, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Studio not found" });
    }

    await logAdminActivity(
      req.user.id, "suspend_studio", "studio", id,
      { reason },
      req.ip
    );

    res.json({ 
      message: "Studio suspended",
      studio: result.rows[0] 
    });
  } catch (error) {
    console.error("Suspend studio error:", error);
    res.status(500).json({ error: "Failed to suspend studio" });
  }
};

/**
 * Geocode a studio's address
 * POST /api/admin/studios/:id/geocode
 */
export const geocodeStudio = async (req, res) => {
  try {
    const { id } = req.params;
    const { address, city, state, country } = req.body;

    // Get current studio data
    const studioResult = await pool.query(
      "SELECT address, city, state, country FROM studios WHERE id = $1",
      [id]
    );

    if (studioResult.rows.length === 0) {
      return res.status(404).json({ error: "Studio not found" });
    }

    const studio = studioResult.rows[0];
    const geocoded = await geocodeAddress(
      address || studio.address,
      city || studio.city,
      state || studio.state,
      country || studio.country || "USA"
    );

    if (!geocoded) {
      return res.status(400).json({ error: "Could not geocode address" });
    }

    const result = await pool.query(`
      UPDATE studios 
      SET lat = $1, lng = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING id, lat, lng
    `, [geocoded.lat, geocoded.lng, id]);

    await logAdminActivity(
      req.user.id, "geocode_studio", "studio", id,
      { lat: geocoded.lat, lng: geocoded.lng, displayName: geocoded.displayName },
      req.ip
    );

    res.json({
      message: "Studio geocoded successfully",
      location: {
        lat: geocoded.lat,
        lng: geocoded.lng,
        displayName: geocoded.displayName
      }
    });
  } catch (error) {
    console.error("Geocode studio error:", error);
    res.status(500).json({ error: "Failed to geocode studio" });
  }
};

// ==========================================
// User Management
// ==========================================

/**
 * Get all users
 * GET /api/admin/users
 */
export const getAdminUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;

    let query = `
      SELECT 
        u.id, u.name, u.email, u.phone, u.is_active, u.created_at,
        COUNT(DISTINCT b.id) as booking_count
      FROM users u
      LEFT JOIN bookings b ON b.user_id = u.id
      WHERE 1=1
    `;
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }

    query += ` GROUP BY u.id ORDER BY u.created_at DESC`;

    const offset = (page - 1) * limit;
    params.push(limit, offset);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    const countResult = await pool.query("SELECT COUNT(*) FROM users");

    res.json({
      users: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].count),
        pages: Math.ceil(countResult.rows[0].count / limit)
      }
    });
  } catch (error) {
    console.error("Get users error:", error);
    res.status(500).json({ error: "Failed to get users" });
  }
};

// ==========================================
// Admin Management (Super Admin Only)
// ==========================================

/**
 * Create a new admin
 * POST /api/admin/admins
 */
export const createAdmin = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Super admin access required" });
    }

    const { name, email, password, role = "admin" } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    const existing = await pool.query(
      "SELECT id FROM admins WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(`
      INSERT INTO admins (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role, created_at
    `, [name, email, hashedPassword, role]);

    await logAdminActivity(
      req.user.id, "create_admin", "admin", result.rows[0].id,
      { name, email, role },
      req.ip
    );

    res.status(201).json({
      message: "Admin created successfully",
      admin: result.rows[0]
    });
  } catch (error) {
    console.error("Create admin error:", error);
    res.status(500).json({ error: "Failed to create admin" });
  }
};

/**
 * Get all admins
 * GET /api/admin/admins
 */
export const getAdmins = async (req, res) => {
  try {
    if (req.user.role !== "super_admin") {
      return res.status(403).json({ error: "Super admin access required" });
    }

    const result = await pool.query(`
      SELECT id, name, email, role, is_active, last_login, created_at
      FROM admins
      ORDER BY created_at DESC
    `);

    res.json({ admins: result.rows });
  } catch (error) {
    console.error("Get admins error:", error);
    res.status(500).json({ error: "Failed to get admins" });
  }
};
