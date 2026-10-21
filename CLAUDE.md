# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

livetrafikk.no (repo name RuterLive) is a real-time map of public transport in Greater Oslo, built on Entur's APIs. It is a plain-JS web app: Leaflet frontend bundled by Vite, plus an Express production server that also renders the content pages. No framework, no TypeScript, no linter. Tests use Node's built-in `node:test` (`npm test`, files in `test/`). Code comments, log messages and UI text are in Norwegian, so keep new ones in Norwegian too.

Note: `../AGENTS.md` (Swift/SwiftUI guidelines) belongs to the parent `Developer/` folder and does **not** apply to this repo.

## Commands

```bash
npm install
npm run dev      # Vite dev server, http://localhost:5173
npm run build    # Vite build → dist/
npm run start    # Express server (serves dist/ + API + content pages), http://localhost:3000
npm test         # node --test (all of test/)
npm run memcheck # starts the server, samples RSS for 200 s (needs dist/; --max-mb, --seconds)
node --test test/line-catalog.test.js   # single test file
```

The basemap is Kartverket `topograatone` (no key); dark theme is a CSS filter on `.basemap-tiles`, so route lines and markers are not inverted.

`npm run start` needs a fresh `npm run build`, because Express serves `dist/`. Deploys go to Render through `render.yaml` (Node 20, health check `/health`). `start` caps the heap at 384 MB for Render's free plan, so be careful with memory use on the server. For example, GTFS stops are filtered to an Oslo bbox for this reason.

## Architecture

### Two runtime modes: dev vs prod

The client takes different data paths depending on `import.meta.env.DEV`:

- **Prod (`server.js`)**: every 30 s the client fetches `/api/vehicles-live` → `{ t0, shapesVersion, vehicles }`. `t0` is epoch seconds; an ET vehicle's `path` has points `[lat, lon, arrSec, depSec]` or `[lat, lon, sec]` relative to `t0`, which `js/main.js` decodes once per poll with `decodeVehiclePath` (`shared/vehicle-path.js`) into the ms format `js/markers.js` uses. Route shapes come from `/api/route-shapes-all?v=<shapesVersion>` (cached as immutable), fetched again only when the version changes. The version is the hash of the sorted shape set, and ET-derived shapes are swapped in at most every 30 min (`server/shapes-version.js`), so it changes rarely. The server also fills `from`/`to` for GPS vehicles from the shapes (`shared/route-match.js`), so the browser does not call Journey Planner. `/api/initial-data` (ms paths, everything in one response) is legacy/fallback for old cached clients. Polling (and shape retries) pause while the tab is hidden (`js/visibility.js`).
- **Dev (Vite)**: `vite.config.js` only proxies the raw `/api/entur*` paths to api.entur.io. Server-only endpoints (`/api/vehicles-live`, `/api/initial-data`, `/api/route-shapes*`, `/api/quay-coords`, `/api/stops-*`, `/api/departures`) **do not exist** there. When `/api/initial-data` fails, `js/main.js` falls back to client-side polling: `api.js` for GraphQL vehicles and `et-api.js` for SIRI ET parsed in the browser. Stop search, departures and GTFS coordinates therefore only work fully under `npm run build && npm run start`.

### Vehicle positions

Ruter does not publish GPS to Entur, so there are two vehicle sources, merged by `vehicleId`:
1. **Entur Vehicles GraphQL** (`server/vehicles-cache.js`, 20 s cache): real GPS for the operators that provide it.
2. **SIRI ET (Estimated Timetable)**: bus, metro, tram and boat positions are *interpolated* between stops from departure times. Server: `server/et-cache.js` fetches the large ET XML (~25 MB) at most every 90 s, with a 5-minute backoff after a 429, and parses it as it streams in (`server/et-parse.js`, no DOM); only the parsed journeys are kept, never the XML. `/api/et-cached` is gone (410). `server/et-vehicles-service.js` computes positions and caches the result for 15 s. Line modes come from `server/line-modes.js` (shared module cache, 24 h, failures 10 min, unknown lines fetched in batches of 50). Quay coordinates come from the Entur GTFS zip (`server/gtfs-stops-loader.js`, about 95 MB, downloaded at most once every 23 h).

The ET parsing, interpolation and mode-detection logic exists **twice**: server-side (`server/et-vehicles-service.js`, `server/shape-service.js`) and client-side (`js/et-api.js`, the dev/fallback path). Helpers such as `getModeFromLineNumFallback` and `mapJpTransportMode` are copy-pasted across these files. A behaviour change usually has to be made in every copy.

Transport mode comes from Journey Planner's `transportMode` per line. The line-number fallback (1–6 → metro, 11–19 → tram, ≥20 → bus) is used only when JP has no data.

### Route shapes

The server merges shapes from several sources with `mergeShapes` (key `mode|line|from|to`, and the shape with more points wins):
- `server/shape-service.js`: shapes built from ET + Journey Planner, refreshed hourly.
- Rail: `jp-route-fetcher.js` (Entur JP), then `osm-rail-fetcher.js` (OSM), then hard-coded `rail-fallback-shapes.js`, tried in that order.
- Airport buses: static `flybuss-shapes.js`, refreshed weekly from JP.

The client (`js/main.js`) has its own `mergeRouteShapes` with the same key logic. With the live feed it only fetches `/api/rail-shapes` when rail is missing at cold start; `/api/static-network-shapes` and `/api/route-shapes` are only used by the legacy/fallback path. `js/routes.js` handles display rules: metro, tram and rail are always shown, while bus and boat lines and their stops appear only for the selected vehicle.

ET shapes for buses are often partial trips, so for a selected bus/boat (and flybuss without a matching shape) `js/routes.js` fetches `/api/vehicle-route?line=&mode=&dest=&ref=` and draws that instead. `server/vehicle-route.js` picks the Journey Planner pattern whose sign text (`destinationDisplay.frontText` from one sample service journey) or last stop matches `dest`; 2 JP calls per line (3 without `ref`), cached 24 h in a 300-line LRU (failures 10 min). `ref` is the JP line id (`line.ref` in `/api/vehicles-live`, from ET/GPS `lineRef`); without it a line code like 22 is ambiguous across operators, and RUT is preferred.

### Shared code

`config.js` (e.g. `MAX_ROUTE_SPAN_KM`, `isFlytogLineCode`) and `shared/et-journeys.js` (ET vehicle id + one journey per vehicle) are imported by both server and client. Flytoget's line codes are `FLY1`/`FLY2`; `F1`, `F4`, `F6` are Vy/SJ trains.

ET contains several journeys per physical vehicle (previous, current, next trip) sharing one `VehicleRef`, and many journeys lack it. `selectJourneysForVehicles` keeps one journey per vehicle; route shapes are still built from all journeys.

### Content pages (for AdSense)

Server-rendered by Express, all through `server/pages/layout.js` (`renderPage`, `escapeHtml`), which adds the AdSense Auto ads script unless `ads: false`. The map (`/`) must never load AdSense: it is a navigation screen, which is why AdSense rejected the site in Oct 2026.
- `/linje/:slug`: `server/line-catalog.js` (`LINES`, 28 lines) + intros in `content/line-intros.json`. Stop list = Entur JP journey pattern with the highest journeys × stops (cached 24 h, failures 60 s); lines with < 3 stops show the route from the line name instead. Vehicle count from `server/live-vehicles.js` (same merge as `/api/initial-data`), filtered by line code and mode.
- `/guider`, `/guider/:slug`, `/om`: `server/guide-catalog.js` + HTML fragments in `content/` (Norwegian prose: short, no filler, no closing summary, no invented author; facts checked against Entur).
- `/sitemap.xml`, `robots.txt`; the catch-all serves the map only for `/` and `/index.html` (`isMapPath`), everything else gets a 404 page.

### Entur API usage

Every request to Entur must send the header `ET-Client-Name: ruterlive-web`. Rate limits (429) are the main operational problem, which is why the server caches aggressively and shares one cache across all users. Don't add per-user calls straight to Entur from the server without a cache.

### Static and AdSense

`public/` (ads.txt, sw.js, manifest, personvern.html, content.css) is copied into `dist/`. New server routes must be placed before `express.static`/the catch-all. Consent for ads is handled by Google's own CMP (see `ADSENSE.md`), so no custom consent banner should be added. `public/sw.js` never caches `/api/`. `npm run build` also writes `.br`/`.gz` next to the assets (`scripts/precompress.mjs`), served by `server/static-assets.js` with cache headers (`/assets/*` immutable for a year, HTML and `sw.js` `no-cache`). Large JSON responses are precompressed once per cache update (`server/json-cache.js`, ETag + 304); other HTML/XML/JSON responses (including the Entur proxies) are compressed by `compressTextResponses`.
