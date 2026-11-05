# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

livetrafikk.no (repo name RuterLive) is a real-time map of public transport in Greater Oslo and Bergen/Vestland, built on Entur's APIs. It is a plain-JS web app: Leaflet frontend bundled by Vite, plus an Express production server that also renders the content pages. No framework, no TypeScript, no linter. Tests use Node's built-in `node:test` (`npm test`, files in `test/`). Code comments, log messages and UI text are in Norwegian, so keep new ones in Norwegian too.

Note: `../AGENTS.md` (Swift/SwiftUI guidelines) belongs to the parent `Developer/` folder and does **not** apply to this repo.

## Commands

```bash
npm install
npm run dev      # Vite dev server, http://localhost:5173
npm run build    # Vite build → dist/
npm run start    # Express server (serves dist/ + API + content pages), http://localhost:3000
npm test         # node --test (all of test/)
npm run memcheck # starts the server, samples RSS for 200 s (needs dist/; --max-mb, --seconds, --regions oslo,bergen, --log)
node scripts/build-line-catalog.mjs --region bergen   # regenerates shared/lines/<region>.js from Journey Planner
node scripts/build-stop-catalog.mjs --region bergen   # regenerates server/stop-catalog-<region>.json
node --test test/line-catalog.test.js   # single test file
```

The basemap is Kartverket `topograatone` (no key); dark theme is a CSS filter on `.basemap-tiles`, so route lines and markers are not inverted.

`npm run start` needs a fresh `npm run build`, because Express serves `dist/`. Deploys go to Render through `render.yaml` (Node 20, health check `/health`). `start` caps the heap at 384 MB for Render's free plan, so be careful with memory use on the server. For example, GTFS stops are filtered to an Oslo bbox for this reason.

## Architecture

### Two runtime modes: dev vs prod

The client takes different data paths depending on `import.meta.env.DEV`:

- **Prod (`server.js`)**: every 30 s the client fetches `/api/vehicles-live` → `{ t0, shapesVersion, vehicles }`. `t0` is epoch seconds; an ET vehicle's `path` has points `[lat, lon, arrSec, depSec]` or `[lat, lon, sec]` relative to `t0`, which `js/main.js` decodes once per poll with `decodeVehiclePath` (`shared/vehicle-path.js`) into the ms format `js/markers.js` uses. Route shapes come from `/api/route-shapes-all?v=<shapesVersion>` (cached as immutable), fetched again only when the version changes. The version is the hash of the sorted shape set, and ET-derived shapes are swapped in at most every 30 min (`server/shapes-version.js`), so it changes rarely. The server also fills `from`/`to` for GPS vehicles from the shapes (`shared/route-match.js`), so the browser does not call Journey Planner. `/api/initial-data` (ms paths, everything in one response) is legacy/fallback for old cached clients. Polling (and shape retries) pause while the tab is hidden (`js/visibility.js`). The live endpoints (`server/live-routes.js`) take `?region=` (missing → Oslo, unknown or hidden → 400); `server/region-services.js` owns one ET cache, ET-vehicle service, shape service, line geometry and set of memo entries per visible region, and `server/region-runtime.js` drops a region's ET after 60 min without visits.
- **Dev (Vite)**: `vite.config.js` only proxies the raw `/api/entur*` paths to api.entur.io. Server-only endpoints (`/api/vehicles-live`, `/api/initial-data`, `/api/route-shapes*`, `/api/quay-coords`, `/api/stops-*`, `/api/departures`) **do not exist** there. When `/api/initial-data` fails, `js/main.js` falls back to client-side polling: `api.js` for GraphQL vehicles and `et-api.js` for SIRI ET parsed in the browser. Stop search, departures and GTFS coordinates therefore only work fully under `npm run build && npm run start`.

### Vehicle positions

Ruter does not publish GPS to Entur, so there are several vehicle sources, merged by `vehicleId`:
1. **Entur Vehicles GraphQL** (`server/vehicles-cache.js`, 20 s cache; one call with one alias per region; a region whose alias fails keeps its previous list for up to 3 min (`STALE_REGION_MS`), then gets an empty list): real GPS for the operators that provide it.
2. **SIRI ET (Estimated Timetable)**: bus, metro, tram and boat positions are *interpolated* between stops from departure times. Server: `server/et-cache.js` fetches the large ET XML (Oslo ~25 MB, Bergen/SKY ~95 MB) at most every 90 s per region, with a 5-minute backoff after a 429, and parses it as it streams in (`server/et-parse.js`, no DOM); only the parsed journeys are kept, never the XML. The parser drops journeys that are not underway, start within `WAITING_WINDOW_MS` (10 min, `shared/et-journeys.js`) or ended < 2 min ago, so a cache holds only what `et-vehicles-service` would show; the cache size limit is per region (`etMaxSize`: Oslo 5000, Bergen 10000, so SKY's ~6800 journeys are not cut off). Two ET parses never run at the same time. Vehicles that have not started their trip are shown only when the first departure is within 10 min (same rule as BNR trains). SKY ET has no `VehicleMode`/`PublishedLineName`: for regions without a Ruter line-number fallback, journeys with unknown mode are kept and the mode comes from JP (`line-modes.js`); journeys still without mode after the lookup are dropped. `/api/et-cached` is gone (410). `server/et-vehicles-service.js` computes positions and caches the result for 15 s. Line modes come from `server/line-modes.js` (shared module cache, 24 h, failures 10 min, unknown lines fetched in batches of 50). Quay coordinates come from the Entur GTFS zip (`server/gtfs-stops-loader.js`, about 95 MB, downloaded at most once every 23 h).
3. **Trains nationwide** (`server/rail-live.js`, merged into every region's GPS list in `getLiveSources` (`server/region-services.js`), deduped by `vehicleId`): `server/rail-vehicles-cache.js` queries `vehicles(mode: RAIL)` without bbox every 30 s (Vy, Go-Ahead, Flytoget; ~100 trains). Operators without GPS (SJ Norge, SJ, Tågkompaniet) come from SIRI ET dataset `BNR` (`server/rail-et-service.js`, ~1.5 MB, every 4 min, 10 min backoff after 429, parsed with `createEtStreamParser({ mode: 'rail', skipCancelled: true })`); only trains underway or departing within 10 min are shown, and a BNR train is skipped when a GPS train has the same train number + date (`trainKey`: `441:2026-10-26` ≈ `441-2026-10-26`). Ids are `BNR:<DatedVehicleJourneyRef>`, mode is always `rail`. Quays outside the Oslo GTFS bbox are looked up with JP `quay(id)` (25 per call, cached 24 h).

The ET parsing, interpolation and mode-detection logic exists **twice**: server-side (`server/et-vehicles-service.js`, `server/shape-service.js`) and client-side (`js/et-api.js`, the dev/fallback path). Helpers such as `getModeFromLineNumFallback` and `mapJpTransportMode` are copy-pasted across these files. A behaviour change usually has to be made in every copy.

Transport mode comes from Journey Planner's `transportMode` per line. The line-number fallback (1–6 → metro, 11–19 → tram, ≥20 → bus) is used only when JP has no data.

### Route shapes

The server merges shapes from several sources with `mergeShapes` (key `mode|line|from|to`, and the shape with more points wins):
- `server/shape-service.js`: shapes built from ET + Journey Planner, refreshed hourly.
- Rail nationwide: `server/rail-network.js` lists all rail lines from JP (`lines(transportModes: [rail])`, Norwegian authorities VYG/GOA/FLT/SJN only), picks the main patterns per line (rail replacement buses skipped, patterns with the same end stops summed) and fetches `pointsOnLink` only for those (via one `serviceJourney`, since JP v3 has no `journeyPattern(id)`), ~73 JP calls one at a time, at startup (+25 s) and every 24 h. Unclipped, rail tolerance ~9 m. Flytoget's JP trace is only its stops, so it is snapped onto the other lines' tracks (`snapToNetwork`). Applied with a second `applyLineGeometry` after the catalog geometry, so it replaces the Oslo-clipped and older rail shapes for every line it covers.
- Rail fallback (until/if the above fails): `jp-route-fetcher.js` (Entur JP trips from Oslo S), then `osm-rail-fetcher.js` (OSM), then hard-coded `rail-fallback-shapes.js`, tried in that order.
- Airport buses: static `flybuss-shapes.js`, refreshed weekly from JP.
- Real track/street geometry: `server/line-geometry.js` fetches JP `pointsOnLink` for every line in `line-catalog.js` except the `national` trains outside Oslo (main pattern per direction + common short variants, Douglas–Peucker ~5 m, rail ~9 m, clipped to `REGION_BBOX`), cached 24 h. In `/api/route-shapes-all` (`liveShapes` in `server/region-services.js`) `applyLineGeometry` replaces all other shapes for those mode+line pairs with these (`pointsAreTrace: true`, stops in `quayStops`). Flytoget has no real trace in JP here (it gets one from `rail-network.js`). Keep `/api/route-shapes-all` ≤ ~500 KB br (`test/line-geometry.test.js` has a byte budget).

The client moves ET vehicles along that geometry: `js/line-geometry.js` projects the vehicle's current stop pair onto the trace shape for its mode + line (+ destination) and places it at the time fraction along the line (`onLinePosition`, called from `motionPosition` in `js/markers.js`). This only happens at zoom ≥ 13 and inside the padded view; otherwise, or when the stops are > 150 m from the line, the straight-line position is used.

The client (`js/main.js`) has its own `mergeRouteShapes` with the same key logic. With the live feed it only fetches `/api/rail-shapes` when rail is missing at cold start; `/api/static-network-shapes` and `/api/route-shapes` are only used by the legacy/fallback path. `js/routes.js` handles display rules: metro, tram and rail are always shown, while bus and boat lines and their stops appear only for the selected vehicle.

ET shapes for buses are often partial trips, so for a selected bus/boat (and flybuss without a matching shape) `js/routes.js` fetches `/api/vehicle-route?line=&mode=&dest=&ref=` and draws that instead. `server/vehicle-route.js` picks the Journey Planner pattern whose sign text (`destinationDisplay.frontText` from one sample service journey) or last stop matches `dest`; 2 JP calls per line (3 without `ref`), cached 24 h in a 300-line LRU (failures 10 min). `ref` is the JP line id (`line.ref` in `/api/vehicles-live`, from ET/GPS `lineRef`); without it a line code like 22 is ambiguous across operators, and RUT is preferred.

### Regions (server and client)

- `server/region-services.js` builds per region the ET cache, vehicles cache, shape/geometry services and live data (`createRegionRegistry`, `getRegionServices(id)`); `server/region-runtime.js` tracks visits per region. States: **active** (visited in the last 10 min, or `alwaysActive` = Oslo), **resting** (10-60 min: no new ET fetches), **unloaded** (> 60 min: ET journeys are dropped; route lines and stops are kept). Each ET cache makes one fetch at `start()` regardless of state, then only while active; a stale cache in a resting/unloaded region is returned without a new fetch, so line pages (and crawlers) never wake a region, and Bergen line pages show a vehicle count only when ET was fetched in the last 10 min. To keep the startup under Entur's ET quota (4/min, shared with the old instance during a Render deploy), non-`alwaysActive` regions make their first fetch 150 s after start (not together with RUT's 90 s refresh), and not before 60 s even on a visit (Oslo RUT at 0 s, BNR at +20 s). `getJourneys()` waits for the first fetch only for `alwaysActive` regions; others return `[]` and fetch in the background (only while active). Data loaded after an unload is dropped again at the next tick (`runtime.loaded`).
- Endpoints take `?region=<id>` (`/api/vehicles-live`, `/api/route-shapes-all`, `/api/initial-data`, stops, departures ...). Missing parameter = `oslo` (old cached clients); unknown or hidden region = 400 (`parseRegionParam`). `/api/route-shapes-all` is budgeted per region (~500 KB br). Line geometry from JP (`pointsOnLink`) outside Oslo is fetched only for lines with `geometry: true` in the generated catalog (Bybanen, flybuss); buses and boats get their route on selection via `/api/vehicle-route`.
- Client: `js/region.js` picks the region from the URL (`/bergen`), remembered choice and, with permission, position; the region picker sits in the layer panel above Tema (`#map-menu` is hidden at >= 1100 px).
- Bybanen (tram) has no realtime at Skyss (Entur has no tram positions for SKY), so Bergen shows tram lines and stops but no moving trams.
- Generated catalogs: `shared/lines/<region>.js` (`scripts/build-line-catalog.mjs --region`) and `server/stop-catalog-<region>.json` (`scripts/build-stop-catalog.mjs --region`). Re-run them when Skyss changes lines; texts stay hand-written.

### Shared code

`shared/regions.js` holds the region settings (`id`, `situationCodespaces` (codespaces whose disruptions belong to the region), `path`, `public`, `alwaysActive`, `authorities`, center, zoom, vehicle/stops/geometry bounds, ET dataset, `etMaxSize`, map link). Oslo (root path) and Bergen (`/bergen`, "Bergen og Vestland", whole Skyss area) are public; server and client read region values from it. `visibleRegions(preview)` = `public: true` plus ids in a preview list, so a new region can be hidden (`public: false`) and tried locally with `REGIONS_PREVIEW=<id>` (server env) and `VITE_REGIONS_PREVIEW=<id>` (client, at build time). `regionFromPath`/`regionAt` take the visible list. `shared/line-mode.js` has `getModeFromLineNumFallback` (Ruter lines `RUT:` only; other operators give null) and `mapJpTransportMode`, replacing the old copies.

`config.js` (e.g. `MAX_ROUTE_SPAN_KM`, `isFlytogLineCode`) and `shared/et-journeys.js` (ET vehicle id + one journey per vehicle) are imported by both server and client. Flytoget's line codes are `FLY1`/`FLY2`; `F1`, `F4`, `F6` are Vy/SJ trains.

ET contains several journeys per physical vehicle (previous, current, next trip) sharing one `VehicleRef`, and many journeys lack it. `selectJourneysForVehicles` keeps one journey per vehicle; route shapes are still built from all journeys.

### Avvik (SIRI SX)

Nationwide disruption messages, shown as a button + panel on the map, on `/avvik`, and as boxes on line and stop pages.
- Source: the Entur Vehicles GraphQL API `situations` field (not a separate SX feed), fetched for the whole country every 2 min by `server/situations.js` (15 s timeout; on failure the last list is kept for up to 15 min, then `null`). One shared cache, no per-user calls.
- `server/situations-model.js`: `normalize`, `isRelevant`, an index, and `situationsForRegion/Stop/Line`. `shared/situation-areas.js` holds `SITUATION_AREAS`, `RAIL_CODESPACES` (includes `NSB`, because Vy train disruptions use that codespace), `CODESPACE_ALIASES` (`VYG` → `NSB`) and `lineRefKeys` (matching of line refs, also used by the client). `shared/situation-format.js` formats validity text. Situations with no affected line or stop (e.g. single departures) are kept in the index but not listed, and not counted.
- The button count is every listable situation in the region, including `noImpact` ones (some operators flag closed stops that way).
- `server/situations-routes.js`: `/api/situations?region=` (unknown region = 400, ETag, `max-age=60`), registered before `express.static`. `server/situation-links.js` links situations to line/stop pages.
- Client: `js/situations.js` (pure functions, importable in node), `js/situations-panel.js` (DOM), polling every 2 min while the tab is visible. Vehicle popups get a note (`js/markers.js`) and the departure board badges (`js/routes.js`; the departures query includes the line id).
- `/avvik` (`server/pages/situations-page.js`) has its own text in `content/avvik.html`, AdSense, is indexed and in the sitemap (`max-age=120`). `renderSituationBox` is used on line and stop pages.
- Like other server-only endpoints, this does not work under Vite dev, only under `npm run build && npm run start`.

### Content pages (for AdSense)

URLs: Oslo is unchanged (`/linje/…`, `/guider/…`, `/holdeplass/…`); other regions use `/<region>`, `/<region>/linje/<slug>`, `/<region>/holdeplass/<slug>`, `/<region>/guider/<slug>`. Content lives in `content/<region>/linje|guider|holdeplass/…` (Oslo in `content/linje|guider|holdeplass`). A region map page (`/bergen`) never loads AdSense and gets its own title/description/canonical (`server/pages/region-map.js`). **Indexed rule**: a Bergen line page with its own text is indexed and in the sitemap; one without text (~410 bus lines) gets `noindex`, `ads: false` and no sitemap entry (thin automatic pages are what AdSense rejected). Booking lines ("Skyss Bestilling") get no page.

Server-rendered by Express, all through `server/pages/layout.js` (`renderPage`, `escapeHtml`), which adds the AdSense Auto ads script unless `ads: false`. The map (`/`) must never load AdSense: it is a navigation screen, which is why AdSense rejected the site in Oct 2026.
- `/linje/:slug`: `server/line-catalog.js` (`LINES`, 62 lines, 28 of them trains: 12 Oslo lines + 16 `national` lines from VYG/GOA/SJN with `region` and their own `map` center; Vy Tåg's F1 is left out) + intros in `content/line-intros.json` + prose in `content/linje/<slug>.html`. `shared/line-list.js` is a hand copy of the catalog. Stop list = Entur JP journey pattern with the highest journeys × stops (cached 24 h, failures 60 s; for rail, replacement-bus patterns are skipped and patterns with the same end stops are summed); lines with < 3 stops show the route from the line name instead. Vehicle count from `server/live-vehicles.js` (same merge as `/api/initial-data`), filtered by line code and mode.
- `/avvik`: disruption list for all regions (see Avvik above), with ads.
- `/guider`, `/guider/:slug`, `/om`: `server/guide-catalog.js` + HTML fragments in `content/` (Norwegian prose: short, no filler, no closing summary, no invented author; facts checked against Entur).
- `/sitemap.xml`, `robots.txt`; the catch-all serves the map only for `/`, `/index.html` and the paths of visible regions (`isMapPath`), everything else gets a 404 page.

### Entur API usage

Every request to Entur must send the header `ET-Client-Name: ruterlive-web`. The Vehicles API is also the source for `situations` (see Avvik). Rate limits (429) are the main operational problem, which is why the server caches aggressively and shares one cache across all users. Don't add per-user calls straight to Entur from the server without a cache.

### Static and AdSense

`public/` (ads.txt, sw.js, manifest, personvern.html, content.css) is copied into `dist/`. New server routes must be placed before `express.static`/the catch-all. Consent for ads is handled by Google's own CMP (see `ADSENSE.md`), so no custom consent banner should be added. `public/sw.js` never caches `/api/`. `npm run build` also writes `.br`/`.gz` next to the assets (`scripts/precompress.mjs`), served by `server/static-assets.js` with cache headers (`/assets/*` immutable for a year, HTML and `sw.js` `no-cache`). Large JSON responses are precompressed once per cache update (`server/json-cache.js`, ETag + 304); other HTML/XML/JSON responses (including the Entur proxies) are compressed by `compressTextResponses`.
