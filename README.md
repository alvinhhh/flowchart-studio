# Flowchart Studio

A free flowchart editor that runs in your browser. No account, ads, or analytics.

[Open Flowchart Studio](https://flowchart.lol/app) · [Source on GitHub](https://github.com/alvinhhh/flowchart-studio)

## Features

- 32 flowchart shapes, editable labels, colors, and notes.
- Connections with labels, automatic routing, and editable bend points.
- Selection, resizing, groups, locks, alignment, and distribution.
- Automatic arrangement, grid snapping, pan, zoom, and undo/redo.
- Pen, mouse, and touch drawing, with an eraser and background options.
- JSON, SVG, high-resolution lossless PNG, and PDF export of the whole diagram.
- Read-only share links that expire after 24 hours.

## Files and storage

Projects use IndexedDB in the current browser profile and site origin. Clearing site data, browser eviction, or device failure can remove them. Export **JSON** backups; JSON preserves editable shapes, connections, notes, drawings, and settings. The loaded editor can work offline, but reopening it offline is not guaranteed.

**SVG** preserves vector geometry. **PNG** exports at 4× resolution, up to 64 megapixels or 16,384 pixels on either side. Large exports use a lower scale within those limits; diagrams too large for a readable PNG should use SVG or PDF. **PDF** uses a single page sized to the diagram, with vector shapes and supported text. Unsupported scripts and emoji use lossless label images. Large PDFs scale to the format's page limit. Notes remain in JSON and shared snapshots; they are not drawn in image or PDF exports.

JSON imports accept up to 10 MiB, 5,000 shapes, 10,000 connections, 1,000 drawing strokes, and 200,000 drawing points. Direct self-connections are unsupported; loops through multiple shapes work.

## Sharing and privacy

Editing and saving do not upload diagrams. **Share → Create link** encrypts a snapshot in the browser and uploads the ciphertext. The decryption key stays in the link's URL fragment. Anyone with the complete link can read the snapshot, including notes, and retain a copy after expiry.

Shared snapshots have a 512 KiB plaintext limit and expire after 24 hours. Cloudflare hosts the site and sharing storage; ordinary hosting request logs may still exist. See the [privacy page](https://flowchart.lol/privacy).

## Run locally

Use Node.js 22 LTS (22.13 or newer) or 24 LTS, and npm.

```sh
npm ci
npm run dev
```

Open [localhost:3000/app](http://localhost:3000/app). Add `?example=1` to open an editable example.

```sh
npm run typecheck
npm run lint
npm test
npx playwright install chromium webkit
npm run test:e2e
npm run build
npm start
```

## Deploy

Production uses Cloudflare Pages direct uploads, with Node.js 22:

```sh
npm run build:pages
```

In the Cloudflare Pages project, bind a KV namespace as `SHARES`. Upload the complete `out/` directory, including `_worker.js` and `_routes.json`. GitHub pushes do not deploy automatically. Sharing requires the Pages worker and KV; it is unavailable under plain local Next.js development or preview.

## Third-party licenses

Bundled notices: [ELK](public/licenses/elkjs.txt), [jsPDF](public/licenses/jspdf.txt), [svg2pdf.js](public/licenses/svg2pdf.txt), and [Noto Sans](public/licenses/noto-sans.txt).
