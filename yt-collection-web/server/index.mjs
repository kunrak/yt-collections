import express from "express";
import session from "express-session";
import passport from "passport";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { config } from "./config.mjs";
import { configurePassport, requireAuth } from "./auth.mjs";
import {
  isStorageEmpty,
  patchUserStorage,
  readUserStorage,
  writeUserStorage,
} from "./user-store.mjs";
import { resolveChannel, refreshChannels } from "./youtube.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const sessionsDir = path.join(__dirname, "..", "data", "sessions");
const sessionTtlSeconds = 60 * 60 * 24 * 30;

const require = createRequire(import.meta.url);
const FileStore = require("session-file-store")(session);

fs.mkdirSync(sessionsDir, { recursive: true });

const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));

configurePassport();

app.use(
  session({
    secret: config.sessionSecret,
    store: new FileStore({
      path: sessionsDir,
      ttl: sessionTtlSeconds,
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax",
      maxAge: sessionTtlSeconds * 1000,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

app.get("/favicon.ico", (_req, res) => {
  res.redirect(302, "/favicon.svg");
});

app.use(express.static(publicDir));

app.get("/api/auth/config", (_req, res) => {
  res.json({
    ok: true,
    authRequired: config.authEnabled,
    googleClientId: config.authEnabled ? config.googleClientId : null,
  });
});

app.get("/api/me", (req, res) => {
  if (!config.authEnabled) {
    res.json({ ok: true, user: null, authRequired: false });
    return;
  }
  if (!req.isAuthenticated?.()) {
    res.status(401).json({ ok: false, error: "Not signed in." });
    return;
  }
  res.json({ ok: true, user: req.user, authRequired: true });
});

if (config.authEnabled) {
  app.get(
    "/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"] }),
  );

  app.get(
    "/auth/google/callback",
    passport.authenticate("google", {
      failureRedirect: "/?auth=failed",
    }),
    (_req, res) => {
      res.redirect("/");
    },
  );

  app.post("/auth/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.json({ ok: true });
      });
    });
  });
}

app.get("/api/storage", requireAuth, async (req, res) => {
  try {
    if (!config.authEnabled) {
      res.status(400).json({
        ok: false,
        error: "Server storage is only used when Google sign-in is enabled.",
      });
      return;
    }
    const storage = await readUserStorage(req.user.id);
    res.json({ ok: true, storage });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Load failed." });
  }
});

app.patch("/api/storage", requireAuth, async (req, res) => {
  try {
    if (!config.authEnabled) {
      res.status(400).json({ ok: false, error: "Sign-in storage is disabled." });
      return;
    }
    const patch = req.body || {};
    const allowed = [
      "ytc_collections",
      "ytc_channels",
      "ytc_videos",
      "ytc_watched",
    ];
    const filtered = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        filtered[key] = patch[key];
      }
    }
    const storage = await patchUserStorage(req.user.id, filtered);
    res.json({ ok: true, storage });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Save failed." });
  }
});

app.post("/api/storage/import-local", requireAuth, async (req, res) => {
  try {
    const incoming = req.body?.storage;
    if (!incoming || typeof incoming !== "object") {
      res.status(400).json({ ok: false, error: "Invalid storage payload." });
      return;
    }
    const current = await readUserStorage(req.user.id);
    if (!isStorageEmpty(current)) {
      res.json({ ok: true, imported: false, storage: current });
      return;
    }
    const storage = await writeUserStorage(req.user.id, incoming);
    res.json({ ok: true, imported: true, storage });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Import failed." });
  }
});

app.post("/api/resolve-channel", requireAuth, async (req, res) => {
  try {
    const input = req.body?.input;
    if (!input || typeof input !== "string") {
      res.status(400).json({ ok: false, error: "Channel input is required." });
      return;
    }
    const channel = await resolveChannel(input.trim());
    res.json({ ok: true, channel });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Lookup failed." });
  }
});

app.post("/api/refresh-channels", requireAuth, async (req, res) => {
  try {
    const channelIds = Array.isArray(req.body?.channelIds)
      ? req.body.channelIds.filter((id) => typeof id === "string" && id)
      : [];
    const existingVideos = Array.isArray(req.body?.existingVideos)
      ? req.body.existingVideos
      : [];
    const videos = await refreshChannels(channelIds, existingVideos);
    res.json({ ok: true, videos, result: { refreshed: channelIds.length } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || "Refresh failed." });
  }
});

const server = app.listen(config.port, () => {
  console.log(`Channel Collections web app: ${config.baseUrl}`);
  if (config.authEnabled) {
    console.log("Google sign-in: enabled");
  } else {
    console.log(
      "Google sign-in: not configured (using browser localStorage). Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env for accounts.",
    );
  }
  console.log("Press Ctrl+C to stop the server.");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${config.port} is already in use. Stop the other server or change PORT in .env.`,
    );
  } else {
    console.error("Server failed to start:", err.message);
  }
  process.exit(1);
});
