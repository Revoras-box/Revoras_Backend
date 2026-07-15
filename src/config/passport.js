import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import jwt from "jsonwebtoken";
import * as userRepo from "../repositories/user.repository.js";

/**
 * Same minimal `{ id, tv }` token shape as the rest of Phase 2.3's auth
 * system (report.md §4.1, auth.service.js) - Google sign-in is just another
 * way to authenticate the same `users` identity, not a separate role.
 */
const issueToken = (user) => jwt.sign({ id: user.id, tv: user.token_version }, process.env.JWT_SECRET, { expiresIn: "7d" });

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
        const avatarUrl = profile.photos[0]?.value;

        let user = (await userRepo.findByGoogleId(googleId)) || (await userRepo.findByEmail(email));

        if (user) {
          if (!user.google_id) {
            user = await userRepo.setGoogleId(user.id, googleId);
          }
          return done(null, { user, token: issueToken(user) });
        }

        user = await userRepo.create({
          name,
          email,
          google_id: googleId,
          avatar_url: avatarUrl,
          email_verified: true,
        });

        return done(null, { user, token: issueToken(user) });
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
