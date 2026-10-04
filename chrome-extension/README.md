# Channel Collections for YouTube (Chrome)

Chrome extension (Manifest V3). Same collections UI as the Firefox add-on. Data stays in `chrome.storage.local`. The extension reads public YouTube channel pages; it does not use a YouTube Data API key.

Load this folder unpacked: `chrome-extension/`.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this `chrome-extension` directory
5. Pin the extension and click the toolbar icon to open the dashboard

After you edit files, click **Reload** on the extension card in `chrome://extensions`.

## Files Chrome loads

- `manifest.json` — Manifest V3, `storage` plus `host_permissions` for `*.youtube.com`
- `background.js` — service worker (`chrome.action` opens the dashboard)
- `dashboard.html` / `dashboard.js` / `dashboard.css`
- `icons/`

## Git ignore (this package)

`*.crx`, `*.pem`, and `*.zip` are ignored. Never commit a Chrome Web Store private key (`.pem`).
