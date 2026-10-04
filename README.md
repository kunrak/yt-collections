# Channel Collections for YouTube

A Firefox extension that groups YouTube channels into private collections.
Auth and data live in your Supabase project. The YouTube API key stays on the
server as an Edge Function secret — it is never shipped in the extension.

## Build Environment Requirements

### Operating System
- Linux (tested on Ubuntu/Debian)
- macOS
- Windows 10/11

### Required Software

| Program | Minimum Version | Installation |
|---------|----------------|--------------|
| Node.js | v22.22.2 or later | https://nodejs.org/ — download the LTS version |
| npm | v10 or later | Included with Node.js |
| Firefox | 142 or later | https://www.mozilla.org/firefox/ |

**Note:** npm v12 is not compatible with this project. Use Node.js v22+ which includes npm v10+.

To check your versions:
```bash
node --version
npm --version
```

If Node.js is not installed, download and install it from https://nodejs.org/.
After installation, restart your terminal.

## Step-by-Step Build Instructions

### 1. Install dependencies

```bash
npm install
```

This installs `esbuild` (for bundling) and `web-ext` (for Firefox extension testing).

### 2. Configure the extension

Edit `src/config.js` (create if it does not exist):

```js
export const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
export const SUPABASE_ANON_KEY = "eyJ...";
```

### 3. Build the extension

```bash
npm run build
```

This runs `build.mjs` which uses esbuild to bundle `src/dashboard.js` and `src/background.js` into `dist/dashboard.js` and `dist/background.js`.

### 4. Load the extension in Firefox

Option A — Load from source folder:
```bash
npm run firefox
```

Option B — Manual load:
1. Open Firefox and navigate to `about:debugging`
2. Click **This Firefox** (or **This Nightly**)
3. Click **Load Temporary Add-on**
4. Select `manifest.json` from the project root directory

### 5. Package the extension (optional)

To create an installable `.xpi` file:
```bash
npx web-ext build --source-dir . --artifacts-dir .
```

This produces `channel_collections_for_youtube-2.0.0.zip` in the project directory.

## Project Structure

```
src/                  Extension source files (not minified)
  dashboard.js        Main UI logic
  background.js       Background service worker
dist/                 Built output (bundled and minified by esbuild)
  dashboard.js
  background.js
manifest.json         Firefox extension manifest
build.mjs             Build script using esbuild
package.json          npm configuration with build scripts
package-lock.json     Locked dependency versions
supabase/             Database schema, Edge Functions, cron jobs
  schema.sql
  cron.sql
  functions/
```

## Build Tools Used

This extension uses the following build tools:

- **esbuild** (`^0.25.9`): Bundles and minifies JavaScript source files into `dist/`
- **web-ext** (`^8.0.0`): Firefox extension CLI tool for testing and packaging

Build script: `build.mjs` — executed via `npm run build`

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
