/**
 * Produksjonsserver med API-proxy til Entur.
 * Proxier alle API-kall server-side slik at:
 * - Ingen CORS-problemer
 * - Brukerens dårlige båndbredde påvirker mindre (server har ofte bedre linje)
 * - Enkelt å deploye til Railway, Render, Fly.io m.m.
 */

import express from 'express';
import proxy from 'express-http-proxy';
import path from 'path';
import { fileURLToPath } from 'url';
import { getCachedShapes, refreshRouteShapes } from './server/shape-service.js';
import { fetchRailShapesOnly, fetchFlybussShapesOnly } from './server/jp-route-fetcher.js';
import { fetchOsmRailTracks } from './server/osm-rail-fetcher.js';
import { getFlybussShapes } from './server/flybuss-shapes.js';
import { getFallbackRailShapes } from './server/rail-fallback-shapes.js';
import { startEtCachePoll } from './server/et-cache.js';
import { getCachedVehicles } from './server/vehicles-cache.js';
import { loadGtfsStops, ensureGtfsStopsLoaded, getGtfsQuayCache, getStopsInBbox, searchStops } from './server/gtfs-stops-loader.js';
import { getMergedVehicles, countVehiclesForLine, mergeShapes, mergeVehicles, withRouteInfo, withoutDelay } from './server/live-vehicles.js';
import { getEtVehiclesAndShapes } from './server/et-vehicles-service.js';
import { makeJsonEntry, sendJson, memoEntry } from './server/json-cache.js';
import { buildVehiclesPayload } from './server/vehicles-payload.js';
import { sortShapes, createThrottledSnapshot } from './server/shapes-version.js';
import { createLineGeometryService, applyLineGeometry } from './server/line-geometry.js';
import { LINES, getLineBySlug, getLineStops, prewarmLineStops } from './server/line-catalog.js';
import { createVehicleRouteService, parseVehicleRouteParams } from './server/vehicle-route.js';
import { renderLinePage } from './server/pages/line-page.js';
import { getGuideBySlug, loadGuideBody, loadAboutBody, GUIDES } from './server/guide-catalog.js';
import { renderGuidePage } from './server/pages/guide-page.js';
import { renderGuideIndex, renderAboutPage } from './server/pages/guide-index.js';
import { buildSitemap, isMapPath } from './server/pages/sitemap.js';
import { renderNotFound } from './server/pages/not-found.js';
import { registerEnRoutes } from './server/en-routes.js';
import { EN_PAGES } from './server/en-catalog.js';
import { FEATURED_STOPS, getStopBySlug, getStopText } from './server/stop-catalog.js';
import { createStopService } from './server/stop-service.js';
import { renderStopPage, renderStopIndex } from './server/pages/stop-page.js';
import { precompressedStatic, setStaticHeaders, compressTextResponses } from './server/static-assets.js';

function sendNotFound(res) {
  res.set('Cache-Control', 'no-store');
  res.status(404).type('html').send(renderNotFound());
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

let railShapesCache = [];
let flybussShapesCache = [];

async function loadRailShapes() {
  try {
    const enturShapes = await fetchRailShapesOnly();
    if (enturShapes.length > 0) {
      railShapesCache = enturShapes;
      console.log(`[RuterLive] Jernbanekart (Entur): ${enturShapes.length} linjer`);
      return true;
    }
  } catch (e) {
    console.warn('[RuterLive] Entur jernbane:', e.message);
  }
  try {
    const osmShapes = await fetchOsmRailTracks();
    if (osmShapes.length > 0) {
      railShapesCache = osmShapes;
      console.log(`[RuterLive] Jernbanekart (OSM): ${osmShapes.length} strekninger`);
      return true;
    }
  } catch (e) {
    console.warn('[RuterLive] OSM jernbane:', e.message);
  }
  if (railShapesCache.length === 0) {
    railShapesCache = getFallbackRailShapes();
    console.log('[RuterLive] Jernbanekart (fallback): ' + railShapesCache.length + ' linjer');
  }
  return railShapesCache.length > 0;
}

function loadFlybussShapes() {
  flybussShapesCache = getFlybussShapes();
  console.log(`[RuterLive] Flybuss-rutenett: ${flybussShapesCache.length} linjer`);
}

const FLYBUSS_REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // Ukentlig

async function refreshFlybussFromJp() {
  try {
    await ensureGtfsStopsLoaded();
    const jpShapes = await fetchFlybussShapesOnly();
    if (jpShapes.length > 0) {
      flybussShapesCache = mergeShapes(getFlybussShapes(), jpShapes); // JP vinner ved konflikt
      console.log(`[RuterLive] Flybuss oppdatert fra Entur JP: ${jpShapes.length} linjer`);
    }
  } catch (e) {
    console.warn('[RuterLive] Flybuss JP-oppdatering:', e.message);
  }
}

const app = express();
app.use(compressTextResponses()); // gzip/br for server-rendret HTML og XML

// Health check for Render – slik at deploy/rullende oppdateringer fungerer
app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

// ads.txt – kreves av Google AdSense, må være tilgjengelig på roten
app.get('/ads.txt', (_req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'dist', 'ads.txt'));
});

// robots.txt – tillater søkemotorer
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /

Sitemap: https://livetrafikk.no/sitemap.xml
`);
});

app.get('/sitemap.xml', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').send(
    buildSitemap({ lines: LINES, guides: GUIDES, enPages: EN_PAGES, stops: FEATURED_STOPS })
  );
});

// Statiske rutekart slått sammen; bygges på nytt bare når en av kildecachene er byttet ut.
const mergeStaticShapes = memoEntry((base, rail, flybuss) => mergeShapes(mergeShapes(base, rail), flybuss));
function getAllShapes() {
  return mergeStaticShapes(getCachedShapes(), railShapesCache, flybussShapesCache);
}

// Store rutekart-svar: forhåndskomprimert med ETag, bygget ved første forespørsel etter kildebytte.
const routeShapesEntry = memoEntry((all) => makeJsonEntry(all));
const railShapesEntry = memoEntry((rail) => makeJsonEntry(rail));
const staticNetworkEntry = memoEntry((rail, flybuss) => makeJsonEntry([...rail, ...flybuss]));

// Tom jernbane ved kald start skal ikke caches en time i nettleseren
const staticCacheControl = (hasRail) => (hasRail ? 'public, max-age=3600' : 'public, max-age=30');

// Cached rutekart – klart med en gang brukeren laster siden (inkl. jernbane og flybuss fra egen preload)
app.get('/api/route-shapes', (req, res) => {
  sendJson(req, res, routeShapesEntry(getAllShapes()), { cacheControl: 'public, max-age=30' });
});

// Kun jernbaneruter – for å sikre at strekninger alltid lastes
app.get('/api/rail-shapes', (req, res) => {
  sendJson(req, res, railShapesEntry(railShapesCache), {
    cacheControl: staticCacheControl(railShapesCache.length > 0),
  });
});

// Flybuss + jernbane – alltid tilgjengelig, lastes ved oppstart
app.get('/api/static-network-shapes', (req, res) => {
  sendJson(req, res, staticNetworkEntry(railShapesCache, flybussShapesCache), {
    cacheControl: staticCacheControl(railShapesCache.length > 0),
  });
});

// Forhåndskomprimerte live-svar. Nøkkel er identiteten til kildecachene (kjøretøy, ET-resultat,
// rutekart); samme kilder (også et konstant tomt ET-resultat ved feil) gir samme ferdige entry.
const NO_SHAPES = Object.freeze([]);
let lastShapesEntry = null;
// Faktisk trasé fra JP for linjene som alltid vises + flybuss (erstatter rette ET-streker)
const lineGeometry = createLineGeometryService({ timeoutMs: 15000 });
// Sortert, så samme sett gir samme ETag
const liveShapes = memoEntry((all, etShapes, geometry) =>
  sortShapes(applyLineGeometry(mergeShapes(all, etShapes), geometry)));
const liveShapesEntry = memoEntry((shapes) => {
  lastShapesEntry = makeJsonEntry(shapes, lastShapesEntry); // samme innhold → samme entry
  return lastShapesEntry;
});
// ET-rutekart byttes høyst hver 30. min, ellers ny shapesVersion (og ~450 kB per klient) hvert 90. s
const ET_SHAPES_MIN_INTERVAL_MS = 30 * 60 * 1000;
const etShapesSnapshot = createThrottledSnapshot(ET_SHAPES_MIN_INTERVAL_MS);
const shapesVersionOf = (entry) => entry.etag.slice(1, 13);
// Hentes av alle klienter hvert 30. s: høyere komprimering lønner seg (~10 ms per bygging)
// GPS-kjøretøy uten fra/til får dem fra rutekartene her, så nettleseren slipper egne JP-søk
const liveVehiclesEntry = memoEntry((vehiclesData, etResult, shapes, shapesEntry) => makeJsonEntry(
  buildVehiclesPayload(withRouteInfo(mergeVehicles(vehiclesData, etResult), shapes), {
    shapesVersion: shapesVersionOf(shapesEntry),
  }),
  null,
  { gzipLevel: 9, brQuality: 9 }
));
// Gamle klienter: hele formatet med path i ms. Bygges bare når noen ber om det.
const legacyInitialEntry = memoEntry((vehiclesData, etResult, all) => makeJsonEntry({
  vehicles: withoutDelay(mergeVehicles(vehiclesData, etResult)),
  routeShapes: mergeShapes(all, etResult?.shapes ?? NO_SHAPES),
}));

async function getLiveSources() {
  const [vehiclesData, etResult] = await Promise.all([getCachedVehicles(), getEtVehiclesAndShapes()]);
  return { vehiclesData, etResult };
}

async function getLiveEntries() {
  const { vehiclesData, etResult } = await getLiveSources();
  const shapes = liveShapes(getAllShapes(), etShapesSnapshot(etResult?.shapes ?? NO_SHAPES), lineGeometry.getShapes());
  const shapesEntry = liveShapesEntry(shapes);
  const vehiclesEntry = liveVehiclesEntry(vehiclesData, etResult, shapes, shapesEntry);
  return { vehiclesEntry, shapesEntry, shapesVersion: shapesVersionOf(shapesEntry) };
}

// Bare kjøretøy – klienten poller denne hvert 30. s. Rutekart hentes separat og bare ved ny versjon.
// Format: { t0, shapesVersion, vehicles } der ET-path har tider i sekunder relativt til t0.
app.get('/api/vehicles-live', async (req, res) => {
  try {
    const { vehiclesEntry: e } = await getLiveEntries();
    sendJson(req, res, e, { cacheControl: 'public, max-age=15' });
  } catch (err) {
    res.status(503).json({ vehicles: [], shapesVersion: null });
  }
});

// Alle rutekart. Versjonert via ?v=, så nettleseren kan cache dem lenge.
app.get('/api/route-shapes-all', async (req, res) => {
  try {
    const { shapesEntry: e, shapesVersion: ver } = await getLiveEntries();
    const cacheControl = req.query.v && req.query.v === ver
      ? 'public, max-age=86400, immutable'
      : 'public, max-age=30';
    sendJson(req, res, e, { cacheControl });
  } catch (err) {
    res.status(503).json([]);
  }
});

// Alt på en gang – beholdt uendret i format for gamle klienter (bufret JS i nettleseren).
app.get('/api/initial-data', async (req, res) => {
  try {
    const { vehiclesData, etResult } = await getLiveSources();
    sendJson(req, res, legacyInitialEntry(vehiclesData, etResult, getAllShapes()), { cacheControl: 'public, max-age=15' });
  } catch (err) {
    res.status(503).json({ vehicles: [], routeShapes: [] });
  }
});

// Linjeside med stoppliste (Entur JP) og antall kjøretøy akkurat nå
app.get('/linje/:slug', async (req, res) => {
  const line = getLineBySlug(req.params.slug);
  if (!line) return sendNotFound(res);
  try {
    const [stops, vehicles] = await Promise.all([
      getLineStops(line),
      // Kald start: ikke vent på kjøretøy (GTFS/ET) lenger enn 1,5 s; da rendres siden uten telling.
      Promise.race([
        getMergedVehicles().catch(() => null),
        new Promise((resolve) => setTimeout(() => resolve(null), 1500)),
      ]),
    ]);
    res.set('Cache-Control', stops && vehicles ? 'public, max-age=300' : 'no-store');
    res.type('html').send(renderLinePage(line, stops, vehicles ? countVehiclesForLine(vehicles, line) : null));
  } catch (err) {
    console.warn('[RuterLive] Linjeside:', err.message);
    res.set('Cache-Control', 'no-store');
    res.status(503).type('text').send('Siden er midlertidig utilgjengelig');
  }
});

// Holdeplassider: statisk info (24 t) og avganger (60 s) fra Entur JP, delt cache for alle brukere.
const stopService = createStopService();
app.get('/holdeplass/:slug', async (req, res) => {
  const stop = getStopBySlug(req.params.slug);
  if (!stop) return sendNotFound(res);
  try {
    const [info, departures, text] = await Promise.all([stopService.getInfo(stop), stopService.getDepartures(stop), getStopText(stop.slug)]);
    res.set('Cache-Control', departures ? 'public, max-age=30' : 'no-store');
    res.type('html').send(renderStopPage(stop, info, departures, { text }));
  } catch (err) {
    console.warn('[RuterLive] Holdeplasside:', err.message);
    res.set('Cache-Control', 'no-store');
    res.status(503).type('text').send('Siden er midlertidig utilgjengelig');
  }
});

app.get('/holdeplasser', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderStopIndex(FEATURED_STOPS));
});

// Guideoversikt, guider og Om-side (statisk innhold fra content/)
app.get('/guider', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderGuideIndex(GUIDES, LINES));
});

app.get('/guider/:slug', async (req, res) => {
  const guide = getGuideBySlug(req.params.slug);
  if (!guide) return sendNotFound(res);
  try {
    const body = await loadGuideBody(guide.slug);
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(renderGuidePage(guide, body));
  } catch (err) {
    console.warn('[RuterLive] Guide:', err.message);
    res.set('Cache-Control', 'no-store');
    res.status(503).type('text').send('Siden er midlertidig utilgjengelig');
  }
});

app.get('/om', async (_req, res) => {
  try {
    const body = await loadAboutBody();
    res.set('Cache-Control', 'public, max-age=3600');
    res.type('html').send(renderAboutPage(body));
  } catch (err) {
    console.warn('[RuterLive] Om-side:', err.message);
    res.set('Cache-Control', 'no-store');
    res.status(503).type('text').send('Siden er midlertidig utilgjengelig');
  }
});

// Engelske sider (/en, /en/:slug)
registerEnRoutes(app, { sendNotFound });

// Cached kjøretøy (GraphQL) – reduserer 502, 1 kall per 20s
app.get('/api/vehicles-cached', async (_req, res) => {
  try {
    const data = await getCachedVehicles();
    res.set('Cache-Control', 'public, max-age=10');
    res.json(data);
  } catch (err) {
    res.status(503).json({ errors: [{ message: err.message }] });
  }
});

// Hel rute for valgt buss/båt/flybuss fra Entur JP (ET har ofte bare deler av turen).
// Delt cache for alle brukere: 24 t per linje, feil 10 min.
const vehicleRoutes = createVehicleRouteService();
app.get('/api/vehicle-route', async (req, res) => {
  const parsed = parseVehicleRouteParams(req.query);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const entry = await vehicleRoutes.getRouteEntry(parsed.params);
    if (!entry) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.status(404).json({ error: 'fant ingen rute' });
    }
    sendJson(req, res, entry, { cacheControl: 'public, max-age=3600' });
  } catch (err) {
    res.status(503).json({ error: 'rute utilgjengelig' });
  }
});

// Avgangstavle for holdeplass – Entur Journey Planner quay.estimatedCalls
// Avganger for én quay, eller flere (sammenslått stasjon på kartet): ?quayId=NSR:Quay:1,NSR:Quay:2
const DEPARTURE_MAX_QUAYS = 30;
app.get('/api/departures', async (req, res) => {
  const ids = [...new Set(String(req.query.quayId || '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > DEPARTURE_MAX_QUAYS || !ids.every((id) => /^NSR:Quay:\d+$/.test(id))) {
    return res.status(400).json({ error: 'Mangler eller ugyldig quayId' });
  }
  try {
    const timeRange = 21600; // 6t frem – raskere respons
    // Flere quays: færre per quay, så svaret ikke vokser med antall plattformer
    const numberOfDepartures = ids.length === 1 ? 12 : Math.max(3, Math.ceil(30 / ids.length));
    const resJp = await fetch('https://api.entur.io/journey-planner/v3/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'ruterlive-web' },
      body: JSON.stringify({
        query: `query($ids: [String]!) {
          quays(ids: $ids) {
            id
            name
            estimatedCalls(timeRange: ${timeRange}, numberOfDepartures: ${numberOfDepartures}) {
              realtime
              aimedDepartureTime
              expectedDepartureTime
              destinationDisplay { frontText }
              serviceJourney {
                journeyPattern {
                  line { publicCode transportMode }
                }
              }
            }
          }
        }`,
        variables: { ids },
      }),
    });
    const data = await resJp.json();
    const quays = (data?.data?.quays ?? []).filter(Boolean);
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      id: ids[0],
      name: quays.find((q) => q.name)?.name ?? null,
      estimatedCalls: quays.flatMap((q) => q.estimatedCalls ?? []),
    });
  } catch (err) {
    res.status(503).json({ error: err.message, estimatedCalls: [] });
  }
});

// Quay-koordinater fra GTFS – brukes av klient for buss-posisjoner
app.post('/api/quay-coords', express.json({ limit: '100kb' }), async (req, res) => {
  try {
    await ensureGtfsStopsLoaded();
    const gtfs = getGtfsQuayCache();
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const out = {};
    for (const id of ids.slice(0, 1000)) {
      if (typeof id === 'string' && /^NSR:Quay:\d+$/.test(id) && gtfs?.has(id)) {
        out[id] = gtfs.get(id);
      }
    }
    res.set('Cache-Control', 'public, max-age=3600');
    res.json(out);
  } catch (err) {
    res.status(503).json({});
  }
});

// Holdeplasser innenfor kartutsnitt – for visning av alle stopp ved zoom
app.get('/api/stops-in-bbox', async (req, res) => {
  try {
    await ensureGtfsStopsLoaded();
    const minLat = parseFloat(req.query.minLat);
    const maxLat = parseFloat(req.query.maxLat);
    const minLon = parseFloat(req.query.minLon);
    const maxLon = parseFloat(req.query.maxLon);
    if (isNaN(minLat) || isNaN(maxLat) || isNaN(minLon) || isNaN(maxLon) || minLat >= maxLat || minLon >= maxLon) {
      return res.status(400).json({ error: 'Ugyldig bbox' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 2000, 3000);
    const stops = getStopsInBbox(minLat, maxLat, minLon, maxLon, limit);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(stops);
  } catch (err) {
    res.status(503).json([]);
  }
});

// Søk etter holdeplasser etter navn – beriker med retning fra Journey Planner
app.get('/api/stops-search', async (req, res) => {
  try {
    await ensureGtfsStopsLoaded();
    const q = (req.query.q || '').toString().trim();
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
    const stops = searchStops(q, limit);
    if (stops.length === 0) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json([]);
    }
    // Hent retning/description fra Journey Planner for å skille holdeplasser med samme navn
    const ids = stops.slice(0, 15).map((s) => s.id);
    const lines = ids.map((id, i) => `q${i}: quay(id: "${id}") { id name description publicCode }`).join('\n');
    const jpRes = await fetch('https://api.entur.io/journey-planner/v3/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': 'ruterlive-web' },
      body: JSON.stringify({ query: `query { ${lines} }` }),
    });
    const jpData = await jpRes.json();
    const data = jpData?.data;
    const enriched = stops.map((s, i) => {
      const quay = data?.[`q${i}`];
      let displayName = s.name;
      if (quay?.description?.trim()) {
        const desc = quay.description.trim();
        if (!displayName.toLowerCase().includes(desc.toLowerCase())) {
          displayName = `${s.name} (${desc})`;
        }
      } else if (quay?.publicCode?.trim()) {
        displayName = `${s.name} – ${quay.publicCode}`;
      }
      return { ...s, displayName };
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(enriched);
  } catch (err) {
    res.status(503).json([]);
  }
});

// Rå ET-XML fjernet – serveren beholder ikke XML-en (minne). Klienten bruker /api/vehicles-live.
app.use('/api/et-cached', (_req, res) => {
  res.status(410).json({ error: 'et-cached disabled' });
});

// Med userResDecorator bufrer proxyen svaret og sender det med res.send, så compressTextResponses
// kan komprimere JSON (Entur sender ofte ukomprimert). Uten den strømmes svaret rått.
const bufferForCompression = (_proxyRes, data) => data;

app.use(
  '/api/entur',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/realtime/v2/vehicles' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    userResDecorator: bufferForCompression,
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

app.use(
  '/api/entur-et',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/realtime/v1/rest' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
    timeout: 60000, // ET returnerer stor XML; gi tid for full overføring
  })
);

app.use(
  '/api/entur-geocoder',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/geocoder/v1' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    userResDecorator: bufferForCompression,
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

// OSRM fjernet – offentlig server gir 500/429; rutekart bruker rette linjer mellom stopp
app.use('/api/osrm', (_req, res) => {
  res.status(410).json({ error: 'OSRM disabled' });
});

app.use(
  '/api/entur-jp',
  proxy('https://api.entur.io', {
    proxyReqPathResolver: (req) => '/journey-planner/v3' + (req.url && req.url.startsWith('/') ? req.url : '/' + (req.url || '')),
    userResDecorator: bufferForCompression,
    proxyReqOptDecorator: (opt) => {
      opt.headers['ET-Client-Name'] = 'ruterlive-web';
      return opt;
    },
  })
);

const DIST_DIR = path.join(__dirname, 'dist');
app.use(precompressedStatic(DIST_DIR));
app.use(express.static(DIST_DIR, { setHeaders: (res, file) => setStaticHeaders(res, file, DIST_DIR) }));
app.get('*', (req, res) => {
  if (!isMapPath(req.path)) return sendNotFound(res);
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const LINE_GEOMETRY_DELAY_MS = 45000;
const LINE_GEOMETRY_RETRY_MS = 11 * 60 * 1000; // etter negativ cache (10 min)
let lineGeometryRetries = 0;
function refreshLineGeometry(isRetry = false) {
  if (!isRetry) lineGeometryRetries = 0;
  lineGeometry.refresh(isRetry ? {} : { maxAgeMs: 23 * 60 * 60 * 1000 })
    .then(({ failed }) => {
      if (failed > 0 && lineGeometryRetries < 3) {
        lineGeometryRetries++;
        setTimeout(() => refreshLineGeometry(true), LINE_GEOMETRY_RETRY_MS);
      }
    })
    .catch((e) => console.warn('[RuterLive] Linjetrasé:', e.message));
}

async function startup() {
  loadFlybussShapes(); // Synkron – statiske koordinater
  // Åpne porten først: Render vekker tjenesten og forventer svar raskt (ellers «hibernate-wake-error»).
  // Jernbanekart og annen tung oppstart kjøres etterpå; klienten prøver /api/rail-shapes på nytt.
  app.listen(PORT, async () => {
    console.log(`RuterLive kjører på http://localhost:${PORT}`);
    loadRailShapes().then((railOk) => {
      if (!railOk) {
        setTimeout(() => loadRailShapes().then((ok) => ok && console.log('[RuterLive] Jernbane retry: ok')), 30000);
        setTimeout(() => loadRailShapes().then((ok) => ok && console.log('[RuterLive] Jernbane retry: ok')), 120000);
      }
    });
    getCachedVehicles().catch((e) => console.warn('[RuterLive] Vehicles cache prewarm:', e.message));
    startEtCachePoll();
    refreshRouteShapes()
      .then((shapes) => console.log(`[RuterLive] Rutekart cache: ${shapes?.length ?? 0} linjer (inkl. jernbane, flybuss)`))
      .catch((e) => console.warn('[RuterLive] Rutekart preload:', e.message));
    setInterval(refreshRouteShapes, 60 * 60 * 1000);
    setInterval(loadRailShapes, 7 * 24 * 60 * 60 * 1000); // Ukentlig (30d overstiger Node sin 32-bit timeout)

    // Flybussruter fra Entur JP – ukentlig automatisk oppdatering
    setTimeout(prewarmLineStops, 20000); // Stopplister til linjesidene
    setTimeout(refreshFlybussFromJp, 15000); // Etter oppstart
    setInterval(refreshFlybussFromJp, FLYBUSS_REFRESH_MS);
    // Linjetrasé etter GTFS-lastingen (minnetopp), deretter hvert døgn; nytt forsøk ved feil
    setTimeout(() => refreshLineGeometry(), LINE_GEOMETRY_DELAY_MS);
    setInterval(() => refreshLineGeometry(), 24 * 60 * 60 * 1000);
  });
}
startup();
