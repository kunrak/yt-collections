# Channel Collections for YouTube

A Manifest V3 extension that groups YouTube channels into private collections.
Auth and data live in your Supabase project. The YouTube API key stays on the
server as an Edge Function secret — it is never shipped in the extension.

## What you need from me later

Paste these into `src/config.js` when you have them:

- Supabase project URL (`https://YOUR_PROJECT_REF.supabase.co`)
- Supabase **anon / publishable** key (safe for the extension)

Do **not** put the `service_role` key in the extension.

---

## 1. Database schema

Supabase Dashboard → **SQL Editor** → New query.

Paste and run all of [`supabase/schema.sql`](supabase/schema.sql).

That creates `channels`, `videos`, `collections`, `collection_channels`, indexes,
and RLS. Authenticated users can only CRUD their own collections. `channels` and
`videos` are readable by any signed-in user and writable only via the service
role (Edge Functions).

---

## 2. YouTube API key (server secret)

1. Create a Google Cloud API key with **YouTube Data API v3** enabled.
2. In Supabase: **Project Settings → Edge Functions → Secrets**
   (or **Edge Functions → Manage secrets**).
3. Add:

   | Name | Value |
   |------|--------|
   | `YOUTUBE_API_KEY` | your YouTube Data API key |

CLI equivalent:

```bash
npx supabase secrets set YOUTUBE_API_KEY=AIza... --project-ref YOUR_PROJECT_REF
```

You do **not** need to re-deploy functions after setting a secret.

---

## 3. Google sign-in

1. Supabase Dashboard → **Authentication → Providers → Google** → enable it.
   Use a Google OAuth Client ID/secret (Web application type).
2. In that Google Cloud OAuth client, add authorized redirect URI:

   `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`

3. Supabase → **Authentication → URL Configuration**:
   - **Site URL**: `https://YOUR_PROJECT_REF.supabase.co`
   - **Redirect URLs** — add the extension identity URL:
     - Chrome: `https://<extension-id>.chromiumapp.org/`
     - Firefox: copy it from the extension **Settings** panel after loading
       (field “OAuth redirect URL”), or from
       `browser.identity.getRedirectURL()`.

Temporary Firefox add-ons get a new redirect URL if you reload from disk;
add that URL again if Google sign-in fails after a reload.

---

## 4. Deploy Edge Functions

From this repo (after `npx supabase login` and linking the project):

```bash
npx supabase functions deploy resolve-channel --project-ref YOUR_PROJECT_REF
npx supabase functions deploy refresh-channels --project-ref YOUR_PROJECT_REF
```

- `resolve-channel` — looks up a handle/URL/ID, upserts `channels`, fetches videos.
- `refresh-channels` — refreshes videos for given channel IDs, or every channel
  that appears in any collection when called with `{ "all": true }` and the
  service role (cron).

---

## 5. Periodic refresh (every 45 minutes)

After the functions are deployed, SQL Editor → paste [`supabase/cron.sql`](supabase/cron.sql).

Replace:

- `YOUR_PROJECT_REF`
- `YOUR_SERVICE_ROLE_KEY` (Project Settings → API → `service_role`)

That stores those values in Vault and schedules `pg_cron` + `pg_net` to POST
`/functions/v1/refresh-channels`.

To unschedule later:

```sql
select cron.unschedule('refresh-youtube-channels');
```

---

## 6. Build and load the extension

```bash
npm install
```

Edit `src/config.js`:

```js
export const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

```bash
npm run build
```

Load the **folder** (not `dist/`) in Firefox `about:debugging` → This Firefox →
Load Temporary Add-on → `manifest.json`, or Chrome `chrome://extensions` →
Load unpacked.

Click the toolbar icon, sign in with Google, create a collection, add a channel.

---

## How data is split

| Data | Scope |
|------|--------|
| `channels`, `videos` | Shared catalog for every user |
| `collections`, `collection_channels` | Private per `auth.users` row (RLS) |

The dashboard reads collections/videos with the user's JWT. YouTube calls only
happen inside Edge Functions using `YOUTUBE_API_KEY`.

## UI

- **Home** — videos from all of your collections, newest first,
  with a collection-name label on each card.
- **A collection** — same Videos/Shorts tabs and add-channel flow as before.
- **Channels** (sidebar) — every distinct channel you follow; click one for
  that channel's last 12 months, still split Videos/Shorts.

## Files

```
src/                  Extension source (bundled with esbuild)
dist/                 Built dashboard.js + background.js
supabase/schema.sql   Tables + RLS
supabase/cron.sql     pg_cron schedule
supabase/functions/   resolve-channel, refresh-channels
```
