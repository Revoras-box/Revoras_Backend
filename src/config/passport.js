import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import pool from "../config/db.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails[0].value;
        const name = profile.displayName;
        const googleId = profile.id;
        const avatar = profile.photos[0]?.value;

        const existing = await pool.query(
          "SELECT * FROM users WHERE google_id = $1 OR email = $2",
          [googleId, email]
        );

        if (existing.rows.length > 0) {
          const user = existing.rows[0];
          
          if (!user.google_id) {
            await pool.query(
              "UPDATE users SET google_id = $1, avatar = $2 WHERE id = $3",
              [googleId, avatar, user.id]
            );
          }

          const token = jwt.sign(
            { id: user.id, role: "user" },
            process.env.JWT_SECRET
          );

          return done(null, { user, token });
        }

        const result = await pool.query(
          `INSERT INTO users (id, name, email, google_id, avatar, email_verified)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [randomUUID(), name, email, googleId, avatar, true]
        );

        const user = result.rows[0];
        const token = jwt.sign(
          { id: user.id, role: "user" },
          process.env.JWT_SECRET
        );

        return done(null, { user, token });
      } catch (error) {
        return done(error, null);
      }
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

export default passport;
