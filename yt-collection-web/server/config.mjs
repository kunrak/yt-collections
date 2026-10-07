import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(rootDir, ".env") });

const port = Number(process.env.PORT) || 3000;
const baseUrl = (process.env.BASE_URL || `http://localhost:${port}`).replace(
  /\/$/,
  "",
);

const googleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
const googleClientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();
const sessionSecret =
  process.env.SESSION_SECRET || "dev-only-change-me-in-production";

const authEnabled = Boolean(googleClientId && googleClientSecret);

export const config = {
  port,
  baseUrl,
  googleClientId,
  googleClientSecret,
  sessionSecret,
  authEnabled,
  isProduction: process.env.NODE_ENV === "production",
};
