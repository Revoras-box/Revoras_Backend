import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

export const signupUser = async (req, res) => {
  try {
    const { name, email, password, emailVerified } = req.body;

    if (!emailVerified) {
      return res.status(400).json({ 
        error: "Please verify your email before signup" 
      });
    }

    const existing = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ 
        error: "Email already registered" 
      });
    }

    const hashed = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password, email_verified)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, email, hashed, true]
    );

    const token = jwt.sign(
      { id: result.rows[0].id, role: "user" },
      process.env.JWT_SECRET
    );

    res.json({ token, user: result.rows[0] });
  } catch (err) {
    res.status(500).json(err.message);
  }
};



export const loginUser = async (req, res) => {
  const { email, password } = req.body;

  const result = await pool.query(
    "SELECT * FROM users WHERE email=$1",
    [email]
  );

  const user = result.rows[0];

  if (!user)
    return res.status(404).json("User not found");

  const valid = await bcrypt.compare(
    password,
    user.password
  );

  if (!valid)
    return res.status(401).json("Invalid credentials");

  const token = jwt.sign(
    { id: user.id, role: "user" },
    process.env.JWT_SECRET
  );

  res.json({ token, user });
};