import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { config } from "./config.mjs";

export function configurePassport() {
  if (!config.authEnabled) return;

  passport.use(
    new GoogleStrategy(
      {
        clientID: config.googleClientId,
        clientSecret: config.googleClientSecret,
        callbackURL: `${config.baseUrl}/auth/google/callback`,
      },
      (_accessToken, _refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value || "";
        done(null, {
          id: profile.id,
          email,
          name: profile.displayName || email || "User",
          picture: profile.photos?.[0]?.value || "",
        });
      },
    ),
  );

  passport.serializeUser((user, done) => {
    done(null, user);
  });

  passport.deserializeUser((user, done) => {
    done(null, user);
  });
}

export function requireAuth(req, res, next) {
  if (!config.authEnabled) return next();
  if (req.isAuthenticated?.()) return next();
  res.status(401).json({ ok: false, error: "Sign in required." });
}
