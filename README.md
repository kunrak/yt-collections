# Channel Collections for YouTube

A Chrome extension that lets you follow only the channels you pick, grouped
into your own topic collections — each with separate Videos and Shorts feeds.
It does **not** modify youtube.com; it opens its own dashboard page instead.

## 1. Get a free YouTube Data API key

1. Go to https://console.cloud.google.com/ and create a project (or reuse one).
2. Open **APIs & Services → Library**, search for **YouTube Data API v3**, and enable it.
3. Open **APIs & Services → Credentials → Create Credentials → API key**.
4. Copy the key. (Optional but recommended: click into the key and restrict it
   to the YouTube Data API v3, so it can't be used for anything else.)

This gives you 10,000 free quota units/day, which is far more than enough for
personal use — fetching updates costs roughly 2 units per channel per refresh.

## 2. Load the extension in Chrome

1. Unzip this folder somewhere permanent (don't delete it after loading).
2. Go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `yt-collections` folder.
5. Pin the extension from the puzzle-piece icon in your toolbar.

## 3. Set up

1. Click the extension icon — it opens the dashboard in a new tab.
2. It will prompt you for your API key. Paste it in Settings and save.
3. Click **+ New collection**, name it (e.g. "Tech", "Cooking").
4. Click **Channels → Add**, and paste a channel URL, `@handle`, or channel ID.
5. Repeat for as many channels and collections as you want.

## How it works

- Each collection is just a named set of channels.
- The extension fetches each channel's uploads playlist (not search — this
  keeps API quota usage tiny) and classifies each video as a Short if it's
  60 seconds or under.
- A background alarm refreshes everything automatically every 45 minutes.
  You can also hit **Refresh** in the dashboard any time.
- All data (API key, collections, cached videos) is stored locally in your
  browser via `chrome.storage.local` — nothing is sent anywhere except
  directly to Google's YouTube API.

## Notes / known limitations

- YouTube's API has no official "this is a Short" flag — this extension uses
  the same duration-based heuristic (≤60s) that most third-party tools use.
  It's accurate for the vast majority of Shorts but not 100% guaranteed.
- If a collection's feed looks empty right after adding channels, hit
  **Refresh** — the very first add already fetches videos, but a manual
  refresh re-checks everything.
- If you ever see an API error mentioning quota, you've hit the 10,000
  units/day free cap (very unlikely for personal use) — it resets at
  midnight Pacific time.

## Files

```
manifest.json     Extension configuration (Manifest V3)
background.js     Service worker: API calls, polling, storage
dashboard.html    Main UI markup
dashboard.css     Styling
dashboard.js      Dashboard logic and state
icons/            Toolbar icons
```
