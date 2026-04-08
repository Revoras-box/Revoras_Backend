import express from "express";
import passport from "passport";
import "../config/passport.js";

const router = express.Router();

router.get(
  "/",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  })
);

router.get(
  "/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${process.env.FRONTEND_URL || "http://localhost:3000"}/login?error=google_auth_failed`,
  }),
  (req, res) => {
    const { user, token } = req.user;

    res.redirect(
      `${process.env.FRONTEND_URL || "http://localhost:3000"}/auth/success?token=${token}&user=${encodeURIComponent(
        JSON.stringify(user)
      )}&redirect=/user`
    );
  }
);

export default router;
