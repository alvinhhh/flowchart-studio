# Flowchart Studio

A free, local browser editor for programming flowcharts. Draw branches and loops, save projects on this device, and export editable JSON, PNG, SVG, or PDF. Phase 1 includes no accounts, cloud storage, payments, analytics, or external APIs.

## Run locally

Use Node.js 22 LTS (22.13 or newer) or Node.js 24 LTS, and npm.

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The public page is `/`; the editor is `/app`; `/app?example=1` opens an editable example.

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm start
```

Browser tests require Playwright’s Chromium and WebKit browsers (`npx playwright install chromium webkit`). Tests run against a local server on port 3000; a running production preview is reused.

## Implemented

- Immediate guest canvas; click or drag any of the 32 searchable, categorized sidebar shapes onto the canvas with a shape-only placement preview; multiline labels and notes; five color choices.
- Drag empty canvas to pan; use Select or Shift-drag for box selection, and Space for temporary panning from any tool. Pan, zoom, fit, grid snapping and edge/center alignment guides; multi-selection; duplicate/delete; directed labeled connections, merges and multi-node loops. Reconnect by dragging an endpoint or changing its node/handle in Properties.
- Corner resizing on a single selected shape, with label-fit minimums and a 2,000-pixel maximum per dimension. Connections follow live; each completed resize is one undo step. Escape cancels an unfinished resize.
- Copy/cut/paste within and between documents, preserving internal connections, groups and bends with fresh IDs. System clipboard access falls back to the current editor when unavailable.
- Groups move and align as units. Locking a member protects the whole group from editing and layout movement. Align to six edges/centers or distribute three or more units with equal horizontal/vertical gaps.
- Undo/redo for completed edits and movement; Command shortcuts on Mac and Control shortcuts elsewhere for select all, duplicate and undo/redo, plus copy/cut/paste and group/ungroup, with text-field focus respected. Command/Control-click adds shapes to a selection.
- Alignment snaps nearby edges and centers without changing group offsets. Toggle **Align shapes** to disable it, or hold Option/Alt to bypass both alignment and grid snapping.
- Select a connection to insert or drag bend points; double-click a bend to remove it, or reset the route. Keyboard arrow keys move a focused bend. Automatic orthogonal routing avoids other shapes when space permits.
- **Auto arrange** positions the whole flowchart and adjusts connection sides. It runs locally and is undoable in one step. It preserves the graph, labels, notes, dimensions, appearance and freehand strokes. Groups keep their internal positions and bends, and locked groups stay fixed. Editable external routes are reset to automatic routes. The main forward path stays straight where possible, side branches use separate handles, and feedback edges favor outside routes.
- **Draw** supports mouse, touch, and pen Pointer Events with coalesced samples and pressure-sensitive width. **Eraser** removes whole strokes. Each gesture is one undo step; canceled gestures are discarded. Pen input takes priority over simultaneous touch. Brush width and color are adjustable.
- **Background** selects Dot grid, Graph paper, or Blank. The choice and freehand drawings persist in JSON and appear in image and PDF exports.
- New, rename, duplicate, delete-confirmation and a device-local document list. Autosave restores the last document, checks revisions across tabs, and preserves work on storage failure.
- Versioned editable JSON import/export, vector SVG, full-diagram PNG and one-page A4 PDF export. Imported diagrams get a new document identity while preserving graph IDs and content.
- Blank canvas and an editable order-processing logic example with Yes/No branches, a merge at review, and a correction loop.
- Public homepage, privacy explanation, and guides to flowchart symbols and drawing programming flowcharts, with metadata, linked structured data, a sitemap and crawler rules. No editor bundle prefetch from the homepage.

## Structure

- Next.js App Router and TypeScript, with a server-rendered homepage and privacy page.
- The interactive editor is a separate client entry at `src/components/editor.tsx`. Homepage editor links disable prefetching so the editor is not loaded on the landing page.
- Diagram data is separate from the rendered canvas. The model validates imports and supports 32 node types with shared shape outlines, text regions, and connection anchors. Legacy JSON files without drawings or a background choice still open.
- Browser persistence uses IndexedDB and revision checks in the write transaction to detect a conflicting update from another tab. Save failures and conflicts are surfaced in the editor.
- Automatic arrangement uses the local ELK engine plus flowchart constraints. Its chunk loads on first use; reconnect before first use if it has not loaded yet. Layout never uploads a diagram. The [ELK license and source notice](public/licenses/elkjs.txt) is included.
- SVG export uses shared shape and connection geometry. PNG rasterizes that scene; PDF embeds a 300 dpi browser-rendered JPEG on an A4 page to preserve Unicode text. SVG is the scalable vector format. There is no screenshot or export service.

## Local data and technical limits

Projects belong to the current origin and browser profile. Clearing site data, private browsing limits, browser eviction, or device failure can remove them. Export JSON backups. The loaded editor can work without a connection, but there is no service worker or guaranteed offline reopening.

JSON import accepts files up to 10 MiB, with at most 5,000 nodes, 10,000 edges, 1,000 drawing strokes and 200,000 drawing points per diagram. Individual strokes contain up to 20,000 points; longer live gestures are resampled. These are defensive technical caps, not paid tiers. Direct self-connections are rejected; loops through multiple nodes are supported. Automatic arrangement uses deterministic layout heuristics; it does not guarantee a globally optimal arrangement. PNG export limits output to 16 million pixels and 8,192 pixels per dimension, downscaling when necessary. Extremely large extents that would make text unreadable fail clearly; JSON remains available. Connections support up to 64 manual bend points. Routing is orthogonal with 16-pixel shape clearance; enclosed endpoints and searches exceeding 180,000 grid points use a deterministic fallback that can cross shapes. PDF fits the whole diagram on one A4 page, so very large diagrams may have small text; SVG preserves full vector detail. Undo retains up to 100 completed operations. Labels commit when their field loses focus; notes are JSON metadata and are not drawn in image or PDF exports.

The [privacy page](http://localhost:3000/privacy) describes local storage, import/export behavior, and ordinary website host request logs.

## Hosting and configuration

The production target is `https://flowchart.lol` on Cloudflare Pages. Run `npm run build:pages` with Node.js 22 to create the static `out/` directory. This command defaults `NEXT_PUBLIC_SITE_URL` to `https://flowchart.lol`; an explicitly set origin overrides it. Cloudflare Pages uses build command `npm run build:pages`, build output directory `out`, and Node.js 22 (also recorded in `.node-version`). No Pages Functions or server runtime are needed for the current editor. The Pages project is `flowchart-lol`; direct uploads publish only the contents of `out/`. The source repository remains on GitHub, but it is not connected to automatic Cloudflare builds. For an update, build and test the source, then upload the new `out/` contents as a production deployment in that Pages project. The generated `out/404.html` preserves real missing-page responses. Static assets include cache headers and the editor remains `noindex`.

For a normal local Node.js preview, `npm run build` and `npm start` remain available. Do a normal build again after a Pages build before using `npm start`. It has no required database, account provider, billing provider, or vendor SDK. No paid infrastructure is required for the current static deployment. Local operation requires no service subscription. Cloudflare static asset requests are free and unlimited under the current Pages plan; build, file-count, and file-size limits still apply. Account access, DNS activation, and live HTTPS verification are separate from building the files. Search Console and Bing ownership verification require access to those services; sitemap submission and indexation must be verified separately.

The Pages build uses `https://flowchart.lol`. Set `NEXT_PUBLIC_SITE_URL` explicitly to build for another origin. It must be an absolute HTTP or HTTPS origin, with no path, credentials, query, or fragment. The local default is `http://localhost:3000`; it is not a production domain.

Product name, canonical origin, and future cloud pricing are centralized in `src/lib/config.ts`. The future cloud prices are US$3/month or US$30/year (equivalent to US$2.50/month, billed annually; US$6 less than twelve monthly payments), and `available` is `false`. There is no checkout or subscription implementation in Phase 1.

Metadata includes canonical URLs, Open Graph and Twitter metadata, an SVG icon, a generated social image, `robots.txt`, and a sitemap containing `/`, `/privacy`, `/guides/how-to-draw-a-flowchart`, and `/guides/flowchart-symbols`. `/app` is marked `noindex` but remains crawlable so crawlers can read the directive. The homepage links `WebSite`, `WebApplication`, and creator `Person` data. Guides include visible author credit, original examples, accessible diagrams, `Article` and `BreadcrumbList` data. There are no invented ratings or reviews. No ads, analytics, or tracking scripts are added for search optimization.

Standard search practices apply to AI search features; there is no special AI markup. The current wildcard robots rule allows public crawling, including OAI-SearchBot and GPTBot. Search crawling and model-training crawling can be configured independently if the site's policy changes. Indexing or ranking is not guaranteed.

References: [Next.js metadata](https://nextjs.org/docs/app/getting-started/metadata-and-og-images), [Google noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [Google AI search features](https://developers.google.com/search/docs/appearance/ai-features), [software application structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app), [OpenAI crawlers](https://developers.openai.com/api/docs/bots).

## Roadmap

Phase 2 requires a separate request after review: optional free sign-in with Supabase, explicit opt-in cloud copies with owner authorization and conflict recovery, and Stripe subscriptions at the configured prices. Billing test mode, webhook verification, quotas, operating costs, and a retention policy must be reviewed before live billing. Local editing, saving, imports, and exports remain free.

Later editor work includes diagram search and scoped Mermaid support, additional templates and tested offline reopening. Alignment guides and one-click arrangement are already implemented. Real-time collaboration and AI generation are separate later decisions, with no integrations in this release.

## Verification

Verified on November 2, 2026 using macOS arm64, Node.js 22.23.4, Next.js 16.4.4, Chromium 156.0.8078.4 and Playwright WebKit 27.2. Browsers tested the local production build, without external API keys.

- `npm run typecheck`, `npm run lint`, `npm test`, and the production build pass. Unit tests: 175 passed across serialization/validation, history, IndexedDB conflicts/failures, all 32 shape contours and text regions, alignment, automatic layout, drawing pressure geometry, grouping/locking, clipboard fragments, orthogonal routing, PDF structure and export bounds.
- Browser tests: 110 unique cases across Chromium and WebKit, with affected checks repeated after final fixes. Coverage includes corner resizing, connector bend editing and cancellation, copy/cut/paste between documents, groups, locks, alignment/distribution, SVG/PDF downloads, saved guest editing, drag/drop and shape-only previews, alignment and modifier keys, literal Mac Command shortcuts, default-layout readability and undo, all 32 shapes, background persistence, freehand save/erase/undo/PNG, and scripted pressure input. Existing checks cover document switching, old and new JSON round trips, malformed imports, offscreen PNG content, cross-tab conflicts, failed/quota-limited storage, offline editing, and 200-node diagrams.
- Public HTML works with JavaScript disabled; metadata, free-only structured data, robots and the public sitemap entries agree. Instrumented editing and JSON export made zero HTTP requests after loading. Both engines passed automated axe checks with no serious/critical WCAG A/AA violations in the public page, Documents dialog and selected-node editor. Mobile checks at 390×844 passed collapsible controls, no horizontal overflow, and Help keyboard-focus restoration. Automated checks do not establish complete accessibility conformance.


Not verified: physical drawing tablets and their individual drivers, actual Safari application, older browser releases, slow/mobile hardware, offline reopening, public deployment, live crawler access, search indexing or ranking. There is no account, cloud or billing integration to verify in this phase.

Cloudflare deployment validation: the static Pages build passes TypeScript and the editor/layout/export checks (40 browser cases across Chromium and WebKit). Public HTML and guide checks cover four sitemap routes, production canonical URLs, structured data, no-JavaScript content, mobile layout, and keyboard-accessible tables. Live DNS, TLS, and crawler access are verified separately at release.
