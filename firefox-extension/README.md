# Channel Collections for YouTube (Firefox)

Firefox 142+ add-on. Collections, channels, and videos are stored locally. The extension reads public YouTube channel pages; it does not use a YouTube Data API key.

Load this folder: `firefox-extension/` (`manifest.json` is Manifest V2).

## Install (temporary)

1. Open `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on**
4. Choose `manifest.json` in this directory

Reload the add-on on that page after you change files. Temporary add-ons are removed when Firefox restarts.

## Packaged `.xpi`

Install `channel-collections-firefox.xpi` from this folder if you have a built copy. Rebuild after source changes:

```bash
npm install
npx web-ext build --source-dir . --artifacts-dir dist
```

## Optional npm scripts

Requires Node.js 22+ (npm 10; npm 12 is not supported).

```bash
npm install
npm run build      # bundle src/ into dist/
npm run firefox    # web-ext run
```

The files Firefox loads from this folder are `manifest.json`, `background.js`, `dashboard.html`, `dashboard.js`, `dashboard.css`, and `icons/`. Edit `src/` then copy or rebuild into those entry files if you use the esbuild pipeline.

## Git ignore (this package)

`node_modules/`, `dist/`, `web-ext-artifacts/`, `*.xpi`, `*.zip`, and `*.map` are ignored. Do not commit packaged binaries or build output.
