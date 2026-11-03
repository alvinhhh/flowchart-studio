# Flowchart Studio

A free flowchart editor that runs in your browser. No account or ads.

[Open Flowchart Studio](https://flowchart.lol/app) · [Source on GitHub](https://github.com/alvinhhh/flowchart-studio)

## Features

- 44 flowchart and diagram shapes, editable labels, colors, and notes.
- Connections with labels, automatic routing, editable bend points, and 14 presets for flow, UML, and relationship diagrams. Customize line patterns, widths, and endpoint markers.
- Selection, resizing, groups, locks, alignment, and distribution.
- Automatic arrangement, grid snapping, pan, zoom, and undo/redo.
- Pen, mouse, and touch drawing, with an eraser and background options.
- JSON, SVG, high-resolution lossless PNG, and PDF export of the whole diagram.
- Mermaid code generated from the canvas, with copy and `.mmd` download.
- Download all local diagrams as a ZIP of editable JSON backups.
- Read-only share links that expire after 24 hours.

## Files and storage

Projects use IndexedDB in the current browser profile and site origin. Clearing site data, browser eviction, or device failure can remove them. Export **JSON** backups; JSON preserves editable shapes, connections, notes, drawings, and settings. The loaded editor can work offline, but reopening it offline is not guaranteed.

**SVG** preserves vector geometry. **PNG** exports at 4× resolution, up to 64 megapixels or 16,384 pixels on either side. Large exports use a lower scale within those limits; diagrams too large for a readable PNG should use SVG or PDF. **PDF** uses a single page sized to the diagram, with vector shapes and supported text. Unsupported scripts and emoji use lossless label images. Large PDFs scale to the format's page limit. Notes remain in JSON and shared snapshots; they are not drawn in image or PDF exports.

JSON imports accept up to 10 MiB, 5,000 shapes, 10,000 connections, 1,000 drawing strokes, and 200,000 drawing points. Direct self-connections are unsupported; loops through multiple shapes work.

## Sharing and privacy

Editing and saving do not upload diagrams. **Share → Create link** encrypts a snapshot in the browser and uploads the ciphertext. The decryption key stays in the link's URL fragment. Anyone with the complete link can read the snapshot, including notes, and retain a copy after expiry.

Shared snapshots have a 512 KiB plaintext limit and expire after 24 hours. Cloudflare hosts the site and sharing storage; ordinary hosting request logs may still exist. See the [privacy page](https://flowchart.lol/privacy).

## Site statistics

The homepage shows all-time browser, chart creation, and share counts from the date counting began. A local browser marker prevents repeat visits from counting again. Clearing site data or using another profile counts as a new browser. A chart counts when a new local document is first saved with a shape or drawing; imports, examples, and copies count, but empty documents and later edits do not. A share counts after its encrypted snapshot is stored successfully.

Metric requests contain only an event type, date, and random retry ID, never diagram contents or identifiers. Aggregate totals are stored in Cloudflare D1. Retry IDs are eligible for deletion after 48 hours and cleaned up on later activity. The browser respects Do Not Track and Global Privacy Control. Counts are approximate: blocked requests, offline use, cleared storage, and automated submissions can affect them. The displayed **99.99% uptime** is a fixed value, not measured availability or a guarantee.

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

In the Cloudflare Pages project, bind a KV namespace as `SHARES` and a D1 database as `METRICS`. Apply `migrations/0001_metrics.sql` to D1 and set `SITE_ORIGIN` to the production origin. Upload the complete verified `out/` directory, including `_worker.js` and `_routes.json`. GitHub pushes do not deploy automatically. Sharing and statistics require the Pages worker and its bindings; they are unavailable under plain Next.js development. The Pages build enables metric requests; use `NEXT_PUBLIC_METRICS_ENABLED=0` to build without collection. The API rejects writes from preview origins.

## Third-party licenses

Bundled notices: [React Flow](public/licenses/react-flow.txt), [ELK](public/licenses/elkjs.txt), [jsPDF](public/licenses/jspdf.txt), [svg2pdf.js](public/licenses/svg2pdf.txt), and [Noto Sans](public/licenses/noto-sans.txt).
