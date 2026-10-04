# Channel Collections for YouTube

Browser extensions that group YouTube channels into private collections, with separate Videos, Shorts, and Live feeds. Data stays in the browser (`chrome.storage` / Firefox storage). There is no YouTube API key and no server.

This repo has two packages:

| Folder | Browser | Manifest |
|--------|---------|----------|
| [`firefox-extension/`](firefox-extension/) | Firefox 142+ | v2 |
| [`chrome-extension/`](chrome-extension/) | Chrome (Manifest V3) | v3 |

Click a collection **name** in the sidebar to expand or collapse its channels. Click a channel to filter the feed.

## Firefox

Load for development:

1. Open `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on**
4. Select [`firefox-extension/manifest.json`](firefox-extension/manifest.json)

Or install the packaged file [`firefox-extension/channel-collections-firefox.xpi`](firefox-extension/channel-collections-firefox.xpi) (temporary add-ons are removed when Firefox restarts unless you use a signed/permanent install).

Optional build (needs Node.js 22+ and npm 10; npm 12 is not supported):

```bash
cd firefox-extension
npm install
npm run build
```

`npm run firefox` launches Firefox with the extension via `web-ext`. To rebuild an `.xpi`:

```bash
cd firefox-extension
npx web-ext build --source-dir . --artifacts-dir dist
```

See [`firefox-extension/README.md`](firefox-extension/README.md) for the same steps in more detail.

## Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the [`chrome-extension/`](chrome-extension/) folder
5. Pin **Channel Collections for YouTube** and click the icon to open the dashboard

After you change files, click **Reload** on the extension card.

See [`chrome-extension/README.md`](chrome-extension/README.md) for the same steps.

## What to ignore in git

Root [`.gitignore`](.gitignore) plus folder ignore files skip:

- `node_modules/`
- env files (`.env`, `.env.local`)
- Firefox packs and build output (`.xpi`, `web-ext-artifacts/`, `firefox-extension/dist/`)
- Chrome packs (`.crx`, private `.pem` keys)
- source maps and zip artifacts
