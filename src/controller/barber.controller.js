import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

export const signupBarber = async (req, res) => {
  try {
    const {
      name,
      salonName,
      phone,
      email,
      password,
      emailVerified,
      phoneVerified
    } = req.body;

    if (!emailVerified || !phoneVerified) {
      return res.status(400).json({ 
        error: "Please verify both email and phone before signup" 
      });
    }

    const existing = await pool.query(
      "SELECT id FROM barbers WHERE email = $1 OR phone = $2",
      [email, phone]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: "Email or phone already registered" 
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO barbers
      (id, name, salon_name, phone, email, password, email_verified, phone_verified, registration_fee_paid, registration_fee_amount)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [name, salonName, phone, email, hashed, true, true, true, 0]
    );

    const token = jwt.sign(
      { id: result.rows[0].id, role: "barber" },
      process.env.JWT_SECRET
    );

    res.json({ token, barber: result.rows[0] });
  } catch (error) {
    console.error("Signup error:", error);
    res.status(500).json({ error: "Signup failed" });
  }
};



export const getBarberById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      `SELECT
        b.id,
        b.name,
        b.title,
        b.phone,
        b.email,
        b.image_url,
        b.specialties,
        b.experience_years,
        b.is_active,
        s.name as studio_name,
        s.id as studio_id,
        COALESCE(AVG(r.rating), 0) as rating,
        COUNT(DISTINCT r.id)::int as review_count,
        COUNT(DISTINCT bk.id) FILTER (WHERE bk.status = 'completed')::int as cuts_completed
      FROM barbers b
      LEFT JOIN studios s ON s.id = b.studio_id
      LEFT JOIN reviews r ON r.barber_id = b.id
      LEFT JOIN bookings bk ON bk.barber_id = b.id
      WHERE b.id = $1 AND b.is_active = true
      GROUP BY b.id, s.name, s.id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Barber not found" });
    }

    res.json({ barber: result.rows[0] });
  } catch (error) {
    console.error("Get barber error:", error);
    res.status(500).json({ error: "Failed to fetch barber" });
  }
};

export const loginBarber = async (req, res) => {

  const { phone, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM barbers WHERE phone=$1",
    [phone]
  );

  const barber = result.rows[0];

  if (!barber)
    return res.status(404).json("Not found");

  const valid = await bcrypt.compare(
    password,
    barber.password
  );

  if (!valid)
    return res.status(401).json("Invalid");

  const token = jwt.sign(
    { id: barber.id, role: "barber" },
    process.env.JWT_SECRET
  );

  res.json({ token, barber });
};
