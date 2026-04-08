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
      (name, salon_name, phone, email, password, email_verified, phone_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [name, salonName, phone, email, hashed, true, true]
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