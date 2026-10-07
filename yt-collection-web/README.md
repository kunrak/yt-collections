# Channel Collections (Web)

Web version of **Channel Collections for YouTube** — same collections, channels, Videos / Shorts / Live feeds, refresh rules, watched state, and backup import/export.

## Run locally

```bash
cd yt-collection-web
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000).

For auto-restart while developing:

```bash
npm run dev
```

## Google sign-in (for a public deployment)

Without Google OAuth configured, data stays in **browser `localStorage`** (fine for solo local use).

To give each visitor their own collections on a shared server:

1. Copy `.env.example` to `.env`.
2. In [Google Cloud Console](https://console.cloud.google.com/), create an **OAuth 2.0 Client ID** (Web application).
3. Add **Authorized redirect URI**: `{BASE_URL}/auth/google/callback`  
   Example for local dev: `http://localhost:3000/auth/google/callback`
4. Set in `.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `SESSION_SECRET` (long random string)
   - `BASE_URL` (public URL, e.g. `https://collections.example.com`)
5. Restart the server. Users sign in with Google; collections are stored under `data/users/` on the server (not in git).

On first sign-in, any existing data in that browser’s `localStorage` is imported into the account if the server profile is empty.

## Notes

- Refresh uses the same rules as the extension: all videos from the **last 7 days**, or the **50 most recent** per channel per tab type, whichever is more.
- Backup JSON files use the same `ytc_*` keys as the browser extension.
- The server only proxies YouTube scraping and (when OAuth is enabled) stores per-user collection data.
