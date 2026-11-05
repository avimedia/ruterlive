/**
 * Produksjonsserver med API-proxy til Entur.
 * Proxier alle API-kall server-side slik at:
 * - Ingen CORS-problemer
 * - Brukerens dårlige båndbredde påvirker mindre (server har ofte bedre linje)
 * - Enkelt å deploye til Railway, Render, Fly.io m.m.
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { getCachedVehicles } from './server/vehicles-cache.js';
import { ensureGtfsStopsLoaded, getGtfsQuayCache, getStopsInBbox, getGtfsStopsMap } from './server/gtfs-stops-loader.js';
import { makeJsonEntry, sendJson, memoEntry } from './server/json-cache.js';
import { getRailShapes, getStaticFlybussShapes, loadRailShapes, loadFlybussShapes, refreshFlybussFromJp, FLYBUSS_REFRESH_MS } from './server/static-shapes.js';
import { getRegistry } from './server/region-services.js';
import { getSituationService } from './server/situations.js';
import { registerSituationRoutes } from './server/situations-routes.js';
import { registerLiveRoutes, regionServicesFor } from './server/live-routes.js';
import { LINES, REGION_LINES, prewarmLineStops, jpQuery } from './server/line-catalog.js';
import { createStopPlaceLookup } from './server/stop-search.js';
import { createDepartureBoard } from './server/departure-board.js';
import { createVehicleRouteService, parseVehicleRouteParams } from './server/vehicle-route.js';
import { loadAboutBody, GUIDES } from './server/guide-catalog.js';
import { registerPageRoutes } from './server/page-routes.js';
import { serverVisibleRegions } from './server/region-preview.js';
import { renderGuideIndex, renderAboutPage } from './server/pages/guide-index.js';
import { buildSitemap, isMapPath } from './server/pages/sitemap.js';
import { renderNotFound } from './server/pages/not-found.js';
import { renderSituationsPage } from './server/pages/situations-page.js';
import { createSituationLinks } from './server/situation-links.js';
import { registerEnRoutes } from './server/en-routes.js';
import { EN_PAGES } from './server/en-catalog.js';
import { FEATURED_STOPS, featuredStopsFor, findStopForPlace, placePageFields } from './server/stop-catalog.js';
import { createStopService } from './server/stop-service.js';
import { renderStopIndex } from './server/pages/stop-page.js';
import { precompressedStatic, setStaticHeaders, compressTextResponses } from './server/static-assets.js';
import { registerJourneyVehicleRoute } from './server/journey-vehicle.js';
import { getCachedRailVehicles } from './server/rail-vehicles-cache.js';
import { securityHeaders, canonicalHost, createRateLimiter, createUpstreamBudget, budgetedFetch } from './server/security.js';
import { prewarmNationalRail } from './server/rail-live.js';

function sendNotFound(res) {
  res.set('Cache-Control', 'no-store');
  res.status(404).type('html').send(renderNotFound());
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Ett register for alle synlige regioner (offentlige + REGIONS_PREVIEW): ET, rutekart og live-svar per region
const registry = getRegistry();
const visible = serverVisibleRegions();
const otherRegions = visible.filter((r) => r.path);

const app = express();
app.disable('x-powered-by');
app.use(canonicalHost());
app.use(securityHeaders());
app.use(compressTextResponses()); // gzip/br for server-rendret HTML og XML

// Endepunkter som kan gi nye kall mot Entur: romslig grense per IP (mobilnett deler IP-er)
// og et felles budsjett for kall mot Entur, så et skript ikke bruker opp kvoten for alle.
const apiRateLimit = createRateLimiter({ max: 600, windowMs: 60_000 });
const enturBudget = createUpstreamBudget({ perMinute: 600, burst: 120 });
let lastBudgetWarn = 0;
const userTriggeredFetch = budgetedFetch(enturBudget, (...a) => fetch(...a));
const enturFetch = (url, opts) => userTriggeredFetch(url, opts).catch((e) => {
  if (/For mange oppslag/.test(e.message) && Date.now() - lastBudgetWarn > 60_000) {
    lastBudgetWarn = Date.now();
    console.warn('[RuterLive] Entur-budsjett brukt opp, avviser oppslag en stund');
  }
  throw e;
});

// Health check for Render – slik at deploy/rullende oppdateringer fungerer
app.get('/health', (_req, res) => {
  res.status(200).send('ok');
});

// Minne og oppetid for overvåking utenfra (oppetid som starter på nytt = omstart/krasj)
app.get('/health/details', (_req, res) => {
  const m = process.memoryUsage();
  const mb = (n) => Math.round(n / 1048576);
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.json({ rssMb: mb(m.rss), heapUsedMb: mb(m.heapUsed), uptimeS: Math.round(process.uptime()) });
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
    buildSitemap({
      lines: visible.flatMap((r) => REGION_LINES[r.id] ?? []),
      guides: GUIDES.filter((g) => visible.some((r) => r.id === g.region)),
      enPages: EN_PAGES,
      stops: visible.flatMap((r) => featuredStopsFor(r.id)),
      regions: visible,
    })
  );
});

// Store rutekart-svar: forhåndskomprimert med ETag, bygget ved første forespørsel etter kildebytte.
const railShapesEntry = memoEntry((rail) => makeJsonEntry(rail));
const staticNetworkEntry = memoEntry((rail, flybuss) => makeJsonEntry([...rail, ...flybuss]));

// Tom jernbane ved kald start skal ikke caches en time i nettleseren
const staticCacheControl = (hasRail) => (hasRail ? 'public, max-age=3600' : 'public, max-age=30');

// Kun jernbaneruter – for å sikre at strekninger alltid lastes
app.get('/api/rail-shapes', (req, res) => {
  const rail = getRailShapes();
  sendJson(req, res, railShapesEntry(rail), {
    cacheControl: staticCacheControl(rail.length > 0),
  });
});

// Flybuss + jernbane – alltid tilgjengelig, lastes ved oppstart
app.get('/api/static-network-shapes', (req, res) => {
  const rail = getRailShapes();
  sendJson(req, res, staticNetworkEntry(rail, getStaticFlybussShapes()), {
    cacheControl: staticCacheControl(rail.length > 0),
  });
});

// Live-svar per region (?region=, standard Oslo): /api/route-shapes, /api/vehicles-live,
// /api/route-shapes-all og /api/initial-data. Egne memo-entries per region gir egen ETag og shapesVersion.
registerLiveRoutes(app, { registry });

// Avvik (hele landet), filtrert per region
registerSituationRoutes(app, { service: getSituationService(), visible });

// Linje-, holdeplass- og guidesider og regionale kart (/bergen m.fl.) per synlig region
const stopService = createStopService();
registerPageRoutes(app, { visible, indexPath: path.join(__dirname, 'dist', 'index.html'), sendNotFound, stopService });

app.get('/holdeplasser', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderStopIndex(FEATURED_STOPS, otherRegions.map((r) => ({ region: r, stops: featuredStopsFor(r.id) }))));
});

// Guideoversikt, guider og Om-side (statisk innhold fra content/)
app.get('/guider', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('html').send(renderGuideIndex(
    GUIDES.filter((g) => g.region === 'oslo'),
    LINES,
    otherRegions.map((r) => ({ region: r, guides: GUIDES.filter((g) => g.region === r.id), lines: REGION_LINES[r.id] ?? [] }))
  ));
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

// Avvik for hele landet. Siden bygges på nytt ved ny henting, ellers høyst én gang i minuttet.
const situationLinks = createSituationLinks({ regions: visible, coordsFor: (id) => getGtfsStopsMap()?.get(id) });
let situationsText = null;
let situationsHtml = { key: '', html: '' };
app.get('/avvik', async (_req, res) => {
  try {
    situationsText ??= await readFile(path.join(__dirname, 'content', 'avvik.html'), 'utf8');
  } catch (err) {
    console.warn('[RuterLive] Avvik-side:', err.message);
    res.set('Cache-Control', 'no-store');
    return res.status(503).type('text').send('Siden er midlertidig utilgjengelig');
  }
  const service = getSituationService();
  const index = service.getIndex();
  const now = Date.now();
  const key = index ? `${service.getVersion()}:${Math.floor(now / 60_000)}` : 'none';
  if (situationsHtml.key !== key) {
    situationsHtml = {
      key,
      html: renderSituationsPage({ index, text: situationsText, now, updatedAt: service.getUpdatedAt(), ...situationLinks }),
    };
  }
  res.set('Cache-Control', index ? 'public, max-age=120' : 'no-store');
  res.type('html').send(situationsHtml.html);
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
    res.status(503).json({ errors: [{ message: 'kjøretøydata utilgjengelig' }] });
  }
});

// Hel rute for valgt buss/båt/flybuss fra Entur JP (ET har ofte bare deler av turen).
// Delt cache for alle brukere: 24 t per linje, feil 10 min.
// Én tjeneste per region: uten ref foretrekkes regionens operatør (Oslo: RUT), og cachen deles ikke.
const vehicleRoutes = new Map(registry.regions.map((r) => [r.id, createVehicleRouteService({ fetchFn: enturFetch, region: r })]));
app.get('/api/vehicle-route', apiRateLimit, async (req, res) => {
  const s = regionServicesFor(registry, req, res);
  if (!s) return;
  const parsed = parseVehicleRouteParams(req.query);
  if (!parsed.ok) return res.status(400).json({ error: parsed.error });
  try {
    const entry = await vehicleRoutes.get(s.region.id).getRouteEntry(parsed.params);
    if (!entry) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.status(404).json({ error: 'fant ingen rute' });
    }
    sendJson(req, res, entry, { cacheControl: 'public, max-age=3600' });
  } catch (err) {
    res.status(503).json({ error: 'rute utilgjengelig' });
  }
});

// Avgangstavle for holdeplass – Entur Journey Planner quay.estimatedCalls (server/departure-board.js)
// ?quayId=NSR:Quay:1[,NSR:Quay:2] utvides til alle quays på stoppestedet, så tavla viser alle retninger
// uansett hvilken markør som ble trykket; &expand=0 gir bare de gitte quayene.
// Svaret har quays (plattform/retning per quay), place (stoppested, kommune, linjer) og estimatedCalls med quayId.
const DEPARTURE_MAX_QUAYS = 30;
const stopPlaces = createStopPlaceLookup({ fetchFn: enturFetch });
const departureBoard = createDepartureBoard({ lookup: stopPlaces, jpQueryFn: jpQuery, fetchFn: enturFetch });
app.get('/api/departures', apiRateLimit, async (req, res) => {
  const ids = [...new Set(String(req.query.quayId || '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > DEPARTURE_MAX_QUAYS || !ids.every((id) => /^NSR:Quay:\d+$/.test(id))) {
    return res.status(400).json({ error: 'Mangler eller ugyldig quayId' });
  }
  try {
    let board = await departureBoard.get(ids, { expand: req.query.expand !== '0' });
    // Lenke til holdeplassiden når stoppestedet har en
    const stop = findStopForPlace(board.place, board.quays, visible.map((r) => r.id));
    if (stop) board = { ...board, place: { ...board.place, ...placePageFields(stop) } };
    // Cloudflare holder tavla i 15 s: mange ser på samme holdeplass, ett kall dekker alle
    res.set('Cache-Control', 'public, max-age=15, s-maxage=15');
    res.json(board);
  } catch (err) {
    res.set('Cache-Control', 'no-store');
    res.status(503).json({ error: 'avganger utilgjengelig', estimatedCalls: [] });
  }
});

// Kjøretøyet som kjører en avgang fra tavla (?sj=serviceJourney.id[&region=]), slått opp i data serveren alt har
registerJourneyVehicleRoute(app, { registry, getGps: getCachedVehicles, getRail: getCachedRailVehicles, middleware: [apiRateLimit] });

// Quay-koordinater fra GTFS – brukes av klient for buss-posisjoner
app.post('/api/quay-coords', apiRateLimit, express.json({ limit: '100kb' }), async (req, res) => {
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
app.get('/api/stops-in-bbox', apiRateLimit, async (req, res) => {
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

// Søk etter holdeplasser etter navn: ett treff per stoppested med kommune, linjer og quays.
// Gruppering og linjer fra JP, kommune fra geocoderen; begge cachet per ID i 24 t (stopPlaces).
// Bare holdeplassene innenfor regionens stopsBounds, så et søk i Oslo ikke gir treff i Bergen.
function* stopsInBounds(stops, b) {
  if (!stops) return;
  for (const e of stops) {
    const v = e[1];
    if (v.lat >= b.minLat && v.lat <= b.maxLat && v.lon >= b.minLon && v.lon <= b.maxLon) yield e;
  }
}
app.get('/api/stops-search', apiRateLimit, async (req, res) => {
  const s = regionServicesFor(registry, req, res);
  if (!s) return;
  try {
    await ensureGtfsStopsLoaded();
    const q = (req.query.q || '').toString().trim().slice(0, 60);
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const places = await stopPlaces.search(stopsInBounds(getGtfsStopsMap(), s.region.stopsBounds), q, { lat, lng });
    res.set('Cache-Control', 'public, max-age=300');
    res.json(places);
  } catch (err) {
    res.status(503).json([]);
  }
});

// Rå ET-XML fjernet – serveren beholder ikke XML-en (minne). Klienten bruker /api/vehicles-live.
app.use('/api/et-cached', (_req, res) => {
  res.status(410).json({ error: 'et-cached disabled' });
});

// OSRM fjernet – offentlig server gir 500/429; rutekart bruker rette linjer mellom stopp
app.use('/api/osrm', (_req, res) => {
  res.status(410).json({ error: 'OSRM disabled' });
});

// Rå Entur-proxyer finnes bare i dev (vite.config.js). I prod ville de latt hvem som helst bruke
// klientnavnet vårt mot Entur; nettleseren bruker serverens egne, cachede endepunkter.
app.use(['/api/entur', '/api/entur-et', '/api/entur-geocoder', '/api/entur-jp'], (_req, res) => {
  res.status(410).json({ error: 'ikke tilgjengelig' });
});

const DIST_DIR = path.join(__dirname, 'dist');
app.use(precompressedStatic(DIST_DIR));
app.use(express.static(DIST_DIR, { setHeaders: (res, file) => setStaticHeaders(res, file, DIST_DIR) }));
app.get('*', (req, res) => {
  if (!isMapPath(req.path, visible)) return sendNotFound(res);
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const LINE_GEOMETRY_DELAY_MS = 45000;
const LINE_GEOMETRY_RETRY_MS = 11 * 60 * 1000; // etter negativ cache (10 min)
const lineGeometryRetries = new Map();
function refreshLineGeometry(regionId, isRetry = false) {
  if (!isRetry) lineGeometryRetries.set(regionId, 0);
  registry.get(regionId).lineGeometry.refresh(isRetry ? {} : { maxAgeMs: 23 * 60 * 60 * 1000 })
    .then(({ failed }) => {
      const n = lineGeometryRetries.get(regionId) ?? 0;
      if (failed > 0 && n < 3) {
        lineGeometryRetries.set(regionId, n + 1);
        setTimeout(() => refreshLineGeometry(regionId, true), LINE_GEOMETRY_RETRY_MS);
      }
    })
    .catch((e) => console.warn(`[RuterLive] Linjetrasé ${regionId}:`, e.message));
}
const refreshAllLineGeometry = () => registry.regions.forEach((r) => refreshLineGeometry(r.id));

const RAIL_NETWORK_DELAY_MS = 25000;
const RAIL_NETWORK_RETRY_MS = 11 * 60 * 1000;
let railNetworkRetries = 0;
function refreshRailNetwork(isRetry = false) {
  if (!isRetry) railNetworkRetries = 0;
  registry.railNetwork.refresh()
    .then(({ failed }) => {
      if (failed > 0 && railNetworkRetries < 3) {
        railNetworkRetries++;
        setTimeout(() => refreshRailNetwork(true), RAIL_NETWORK_RETRY_MS);
      }
    })
    .catch((e) => console.warn('[RuterLive] Togruter (hele landet):', e.message));
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
    // Tog i hele landet (GPS + BNR-ET); etter GTFS-start, så quay-oppslag i JP bare gjelder utenfor Oslo
    setTimeout(() => prewarmNationalRail().catch(() => {}), 20000);
    // ET (én henting nå, deretter bare i aktive regioner), rutekart hver time, avlasting etter 60 min
    registry.start();
    getSituationService().start(); // Avvik hvert 2. minutt
    setInterval(loadRailShapes, 7 * 24 * 60 * 60 * 1000); // Ukentlig (30d overstiger Node sin 32-bit timeout)

    // Flybussruter fra Entur JP – ukentlig automatisk oppdatering
    setTimeout(prewarmLineStops, 20000); // Stopplister til linjesidene
    setTimeout(refreshFlybussFromJp, 15000); // Etter oppstart
    setInterval(refreshFlybussFromJp, FLYBUSS_REFRESH_MS);
    // Linjetrasé etter GTFS-lastingen (minnetopp), deretter hvert døgn; nytt forsøk ved feil
    setTimeout(refreshAllLineGeometry, LINE_GEOMETRY_DELAY_MS);
    setInterval(refreshAllLineGeometry, 24 * 60 * 60 * 1000);
    // Togruter i hele landet: før linjetraseen (lette JP-kall, ett om gangen), deretter hvert døgn
    setTimeout(() => refreshRailNetwork(), RAIL_NETWORK_DELAY_MS);
    setInterval(() => refreshRailNetwork(), 24 * 60 * 60 * 1000);
  });
}
startup();
