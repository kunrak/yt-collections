import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "./config.mjs";

const { Pool } = pg;
const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "users",
);

const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: config.isProduction
        ? { rejectUnauthorized: false }
        : false,
    })
  : null;

function emptyStorage() {
  return {
    ytc_collections: [],
    ytc_channels: {},
    ytc_videos: [],
    ytc_watched: [],
  };
}

async function ensureDbSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_storage (
      user_id TEXT PRIMARY KEY,
      storage JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function userPath(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid user id");
  return path.join(dataDir, `${safe}.json`);
}

export async function ensureDataDir() {
  if (pool) return;
  await fs.mkdir(dataDir, { recursive: true });
}

export async function readUserStorage(userId) {
  if (pool) {
    await ensureDbSchema();
    const safeUserId = String(userId);
    const result = await pool.query(
      "SELECT storage FROM user_storage WHERE user_id = $1",
      [safeUserId],
    );
    if (!result.rows[0]) return emptyStorage();
    const data = result.rows[0].storage || {};
    return { ...emptyStorage(), ...data };
  }

  await ensureDataDir();
  try {
    const raw = await fs.readFile(userPath(userId), "utf8");
    const data = JSON.parse(raw);
    return { ...emptyStorage(), ...data };
  } catch (err) {
    if (err.code === "ENOENT") return emptyStorage();
    throw err;
  }
}

export async function writeUserStorage(userId, storage) {
  const next = { ...emptyStorage(), ...storage };

  if (pool) {
    await ensureDbSchema();
    const result = await pool.query(
      `
        INSERT INTO user_storage (user_id, storage, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET storage = EXCLUDED.storage, updated_at = NOW()
        RETURNING storage;
      `,
      [String(userId), JSON.stringify(next)],
    );
    return { ...emptyStorage(), ...(result.rows[0]?.storage || next) };
  }

  await ensureDataDir();
  await fs.writeFile(userPath(userId), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export async function patchUserStorage(userId, patch) {
  const current = await readUserStorage(userId);
  const next = { ...current, ...patch };
  return writeUserStorage(userId, next);
}

export function isStorageEmpty(storage) {
  return (
    (!storage.ytc_collections || storage.ytc_collections.length === 0) &&
    (!storage.ytc_channels ||
      Object.keys(storage.ytc_channels).length === 0) &&
    (!storage.ytc_videos || storage.ytc_videos.length === 0) &&
    (!storage.ytc_watched || storage.ytc_watched.length === 0)
  );
}
