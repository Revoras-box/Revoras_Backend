import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

const normalizeSpecialties = (value) => {
  if (Array.isArray(value)) {
    return value
      .filter((item) => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((item) => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean);
      }
    } catch {
      return trimmed
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
};

/**
 * Studio Owner Signup
 * Creates a new studio with owner account
 * POST /api/studios/auth/signup
 */
export const signupStudio = async (req, res) => {
  const client = await pool.connect();
  
  try {
    const {
      // Owner details
      ownerName,
      email,
      phone,
      password,
      // Studio details
      studioName,
      address,
      city,
      state,
      zipCode,
      // Verification flags
      emailVerified,
      phoneVerified
    } = req.body;

    // Validate required fields
    if (!ownerName || !email || !phone || !password || !studioName || !address) {
      return res.status(400).json({ 
        error: "Missing required fields: ownerName, email, phone, password, studioName, address" 
      });
    }

    // Check verification status
    if (!emailVerified || !phoneVerified) {
      return res.status(400).json({ 
        error: "Please verify both email and phone before signup" 
      });
    }

    // Check if studio owner already exists
    const existingOwner = await client.query(
      "SELECT id FROM studio_owners WHERE email = $1 OR phone = $2",
      [email, phone]
    );

    if (existingOwner.rows.length > 0) {
      return res.status(400).json({ 
        error: "Email or phone already registered" 
      });
    }

    // Start transaction
    await client.query('BEGIN');

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create studio first (with pending approval status)
    const studioResult = await client.query(
      `INSERT INTO studios 
       (name, address, city, state, zip_code, phone, email, is_active, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, false, 'pending')
       RETURNING *`,
      [studioName, address, city || null, state || null, zipCode || null, phone, email]
    );

    const studio = studioResult.rows[0];

    // Create studio owner (explicitly generate UUID to avoid null id issues)
    const ownerResult = await client.query(
      `INSERT INTO studio_owners
       (id, name, email, phone, password, studio_id, email_verified, phone_verified, role)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, true, 'owner')
       RETURNING id, name, email, phone, studio_id, role, created_at`,
      [ownerName, email, phone, hashedPassword, studio.id]
    );

    const owner = ownerResult.rows[0];

    // Create default working hours (Mon-Sat 9-7, Sun closed)
    const defaultHours = [
      { day: 0, open: null, close: null, closed: true },      // Sunday
      { day: 1, open: '09:00', close: '19:00', closed: false }, // Monday
      { day: 2, open: '09:00', close: '19:00', closed: false }, // Tuesday
      { day: 3, open: '09:00', close: '19:00', closed: false }, // Wednesday
      { day: 4, open: '09:00', close: '19:00', closed: false }, // Thursday
      { day: 5, open: '09:00', close: '19:00', closed: false }, // Friday
      { day: 6, open: '10:00', close: '18:00', closed: false }, // Saturday
    ];

    for (const hours of defaultHours) {
      await client.query(
        `INSERT INTO studio_hours (studio_id, day_of_week, open_time, close_time, is_closed)
         VALUES ($1, $2, $3, $4, $5)`,
        [studio.id, hours.day, hours.open, hours.close, hours.closed]
      );
    }

    // Commit transaction
    await client.query('COMMIT');

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: owner.id, 
        studioId: studio.id,
        role: "studio_owner" 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({ 
      message: "Studio registered successfully",
      token, 
      owner: {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        role: owner.role
      },
      studio: {
        id: studio.id,
        name: studio.name,
        address: studio.address,
        city: studio.city,
        state: studio.state
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Studio signup error:", error);
    res.status(500).json({ error: "Signup failed. Please try again." });
  } finally {
    client.release();
  }
};

/**
 * Studio Owner Login
 * POST /api/studios/auth/login
 */
export const loginStudio = async (req, res) => {
  try {
    const { phone, email, password } = req.body;

    if ((!phone && !email) || !password) {
      return res.status(400).json({ error: "Phone/email and password required" });
    }

    // Find owner by phone or email
    const query = phone 
      ? "SELECT * FROM studio_owners WHERE phone = $1"
      : "SELECT * FROM studio_owners WHERE email = $1";
    
    const result = await pool.query(query, [phone || email]);
    const owner = result.rows[0];

    if (!owner) {
      return res.status(404).json({ error: "Account not found" });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, owner.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check if owner is active
    if (owner.is_active === false) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    // Get studio info
    const studioResult = await pool.query(
      "SELECT id, name, address, city, state, image_url, is_active, approval_status FROM studios WHERE id = $1",
      [owner.studio_id]
    );
    const studio = studioResult.rows[0];

    if (!studio) {
      return res.status(404).json({ error: "Studio not found" });
    }

    if (studio.approval_status !== "approved") {
      return res.status(403).json({ error: "Studio is pending admin approval" });
    }

    if (studio.is_active === false) {
      return res.status(403).json({ error: "Studio account is inactive" });
    }

    // Generate token
    const token = jwt.sign(
      { 
        id: owner.id, 
        studioId: owner.studio_id,
        role: "studio_owner" 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Remove password from response
    const { password: _, ...ownerWithoutPassword } = owner;

    res.json({ 
      token, 
      owner: ownerWithoutPassword,
      studio
    });

  } catch (error) {
    console.error("Studio login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

/**
 * Get current studio owner profile
 * GET /api/studios/auth/me
 */
export const getStudioOwnerProfile = async (req, res) => {
  try {
    const ownerId = req.user.id;

    const ownerResult = await pool.query(
      `SELECT id, name, email, phone, studio_id, role, image_url, created_at
       FROM studio_owners WHERE id = $1`,
      [ownerId]
    );

    if (ownerResult.rows.length === 0) {
      return res.status(404).json({ error: "Owner not found" });
    }

    const owner = ownerResult.rows[0];

    // Get studio details
    const studioResult = await pool.query(
      `SELECT * FROM studios WHERE id = $1`,
      [owner.studio_id]
    );

    res.json({
      owner,
      studio: studioResult.rows[0]
    });

  } catch (error) {
    console.error("Get profile error:", error);
    res.status(500).json({ error: "Failed to get profile" });
  }
};

/**
 * Add a barber to the studio
 * POST /api/studios/auth/barbers
 */
export const addBarberToStudio = async (req, res) => {
  try {
    const studioId = req.user.studioId;
    const { name, email, phone, password, title, specialties, image_url, imageUrl, logoUrl } = req.body;
    const normalizedSpecialties = normalizeSpecialties(specialties);
    const resolvedImageUrl = image_url ?? imageUrl ?? logoUrl ?? null;

    if (!name || !phone || !password) {
      return res.status(400).json({ error: "Name, phone, and password are required" });
    }

    // Check if barber already exists
    const existing = await pool.query(
      "SELECT id FROM barbers WHERE phone = $1",
      [phone]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Phone number already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create barber
    const result = await pool.query(
      `INSERT INTO barbers 
       (id, name, email, phone, password, studio_id, title, specialties, image_url, is_active, registration_fee_paid, registration_fee_amount)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
       RETURNING id, name, email, phone, studio_id, title, specialties, image_url, is_active, created_at`,
      [
        name,
        email || null,
        phone,
        hashedPassword,
        studioId,
        title || null,
        JSON.stringify(normalizedSpecialties),
        typeof resolvedImageUrl === "string" && resolvedImageUrl.trim() ? resolvedImageUrl.trim() : null,
        true,
        0
      ]
    );

    res.status(201).json({
      message: "Barber added successfully",
      barber: result.rows[0]
    });

  } catch (error) {
    console.error("Add barber error:", error);
    res.status(500).json({ error: "Failed to add barber" });
  }
};

/**
 * Barber Login (for barbers added by studio)
 * POST /api/studios/auth/barber-login
 */
export const loginBarber = async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: "Phone and password required" });
    }

    const result = await pool.query(
      "SELECT * FROM barbers WHERE phone = $1",
      [phone]
    );

    const barber = result.rows[0];

    if (!barber) {
      return res.status(404).json({ error: "Account not found" });
    }

    const validPassword = await bcrypt.compare(password, barber.password);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (barber.is_active === false) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    // Get studio info
    const studioResult = await pool.query(
      "SELECT id, name, address FROM studios WHERE id = $1",
      [barber.studio_id]
    );

    const token = jwt.sign(
      { 
        id: barber.id, 
        studioId: barber.studio_id,
        role: "barber" 
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    const { password: _, ...barberWithoutPassword } = barber;

    res.json({
      token,
      barber: barberWithoutPassword,
      studio: studioResult.rows[0]
    });

  } catch (error) {
    console.error("Barber login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};
