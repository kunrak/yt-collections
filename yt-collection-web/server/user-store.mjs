import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
  "users",
);

function emptyStorage() {
  return {
    ytc_collections: [],
    ytc_channels: {},
    ytc_videos: [],
    ytc_watched: [],
  };
}

function userPath(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("Invalid user id");
  return path.join(dataDir, `${safe}.json`);
}

export async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function readUserStorage(userId) {
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
  await ensureDataDir();
  const next = { ...emptyStorage(), ...storage };
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
