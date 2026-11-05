/**
 * Regionregisteret: én instans av ET-cache, ET-kjøretøy, rutekart, linjegeometri og ferdige
 * live-svar (memo-entries) per synlig region. Registeret er eneste eier av tjenestene, så Oslo-ET
 * hentes bare én gang. GPS-kjøretøy, tog i hele landet og linjemoduser er felles for alle regioner.
 */

import { createEtCache } from './et-cache.js';
import { createEtVehiclesService } from './et-vehicles-service.js';
import { createShapeService } from './shape-service.js';
import { createLineGeometryService, applyLineGeometry } from './line-geometry.js';
import { createRailNetworkService } from './rail-network.js';
import { createRegionRuntime } from './region-runtime.js';
import { serverVisibleRegions } from './region-preview.js';
import { getCachedVehicles } from './vehicles-cache.js';
import { createNationalRail } from './rail-live.js';
import { getRailShapes, getStaticFlybussShapes } from './static-shapes.js';
import { mergeShapes, mergeVehicles, withRouteInfo, withoutDelay } from './live-vehicles.js';
import { makeJsonEntry, memoEntry } from './json-cache.js';
import { buildVehiclesPayload } from './vehicles-payload.js';
import { sortShapes, createThrottledSnapshot } from './shapes-version.js';
import { LINES, REGION_LINES } from './line-catalog.js';
import { DEFAULT_REGION } from '../shared/regions.js';

const NO_SHAPES = Object.freeze([]);
const NO_ET = Object.freeze({ vehicles: Object.freeze([]), shapes: NO_SHAPES });
// ET-rutekart byttes høyst hver 30. min, ellers ny shapesVersion (og ~450 kB per klient) hvert 90. s
const ET_SHAPES_MIN_INTERVAL_MS = 30 * 60 * 1000;
// Regioner som ikke er alltid aktive: GPS-svaret venter ikke lenger enn dette på ET-beregningen
const ET_WAIT_MS = 1500;
const SHAPES_REFRESH_MS = 60 * 60 * 1000;
const TICK_MS = 60_000;
// Oppstart: Oslo (RUT) henter straks og BNR etter 20 s. Andre regioner henter første ET etter 150 s (ikke samtidig
// med RUT ved 90 s), og et besøk tidligst etter 60 s, så oppstarten ikke gir flere enn ~2 ET-kall i minuttet (Entur-kvoten er 4/min,
// og den gamle instansen henter fortsatt under en Render-deploy).
const ET_START_DELAY_MS = 150_000;
const ET_MIN_START_DELAY_MS = 60_000;

export const shapesVersionOf = (entry) => entry.etag.slice(1, 13);

/**
 * Regionen i `?region=`: mangler (eller tom) → Oslo; ukjent, skjult eller ikke en streng → null (400).
 * @param {object} query req.query
 * @param {object[]} [visible] synlige regioner (offentlige + REGIONS_PREVIEW)
 */
export function parseRegionParam(query, visible = serverVisibleRegions()) {
  const raw = query?.region;
  const id = raw === undefined || raw === '' ? DEFAULT_REGION : raw;
  if (typeof id !== 'string') return null;
  return visible.find((r) => r.id === id) ?? null;
}

/**
 * Linjer med fast trasé fra JP. Oslo: katalogen uten tog utenfor Oslo (de har trasé fra rail-network.js).
 * Andre regioner: linjene med `geometry: true` i den genererte katalogen (tram og flybuss; busser og båter
 * får rute ved valg).
 */
export function linesForRegion(region) {
  if (region.id === DEFAULT_REGION) return LINES.filter((l) => !l.national);
  return (REGION_LINES[region.id] ?? []).filter((l) => l.geometry === true);
}

/** Oslo sine statiske kart (togreserve og flybuss); andre regioner har ingen. */
function defaultStaticShapes(region) {
  return region.id === DEFAULT_REGION ? [getRailShapes(), getStaticFlybussShapes()] : [];
}

/**
 * Tjenestene for én region.
 * @param {object} region
 * @param {{ runtime: object, etFetchFn?: Function, deps?: object, lines?: object[], geometryTimeoutMs?: number }} ctx
 *   etFetchFn/deps/lines overstyres i tester.
 */
export function defaultRegionServices(region, { runtime, etFetchFn, deps = {}, lines, geometryTimeoutMs = 15000 }) {
  const etCacheOptions = {
    datasetId: region.etDatasets[0],
    maxSize: region.etMaxSize, // SKY har ~6800 turer; 3000 kuttet over halvparten av turene som går
    isActive: () => runtime.stateOf(region.id) === 'active',
    runExclusive: runtime.runExclusive, // to ET-parsinger kjører aldri samtidig
    // Ny data etter avlasting (f.eks. en henting som var i gang) slippes igjen ved neste tick
    onLoad: () => runtime.loaded?.(region.id),
    waitForFirst: region.alwaysActive === true,
    startDelayMs: region.alwaysActive ? 0 : ET_START_DELAY_MS,
    minStartDelayMs: region.alwaysActive ? 0 : ET_MIN_START_DELAY_MS,
    // Uten Ruter-fallback for linjenummer: behold turer uten modus, modus settes fra JP (Ruling 8)
    parserOpts: region.lineNumberFallback === 'ruter' ? {} : { keepUnknownMode: true, useVehicleMode: true },
    ...(etFetchFn ? { fetchFn: etFetchFn } : {}),
  };
  const etCache = createEtCache(etCacheOptions);
  return {
    etCache,
    etCacheOptions,
    etVehicles: createEtVehiclesService({ region, etCache, deps }),
    shapes: createShapeService({ region, etCache, deps }),
    lineGeometry: createLineGeometryService({ region, lines: lines ?? linesForRegion(region), timeoutMs: geometryTimeoutMs }),
  };
}

/**
 * Ferdige live-svar for én region. Hver memo-entry er nøkkelet på identiteten til kildene, så samme
 * kilder gir samme ferdigkomprimerte svar (og samme ETag); én sett entries per region.
 */
function createLive(region, s, { getGps, withRail, railNetwork, staticShapesFor, etWaitMs }) {
  const mergeStatic = memoEntry((base, ...extra) => extra.reduce((acc, x) => mergeShapes(acc, x), base));
  const getAllShapes = () => mergeStatic(s.shapes.getCachedShapes(), ...staticShapesFor(region));

  const staticEntry = memoEntry((all) => makeJsonEntry(all));
  let lastShapesEntry = null;
  // Sortert, så samme sett gir samme ETag
  const liveShapes = memoEntry((all, etShapes, geometry, railNet) =>
    sortShapes(applyLineGeometry(applyLineGeometry(mergeShapes(all, etShapes), geometry), railNet)));
  const liveShapesEntry = memoEntry((shapes) => {
    // samme innhold → samme entry; byttes sjelden, så sterkere komprimering i bakgrunnen
    lastShapesEntry = makeJsonEntry(shapes, lastShapesEntry, { brUpgrade: 10 });
    return lastShapesEntry;
  });
  const etShapesSnapshot = createThrottledSnapshot(ET_SHAPES_MIN_INTERVAL_MS);
  // Hentes av alle klienter hvert 30. s: høyere komprimering lønner seg (~10 ms per bygging)
  // GPS-kjøretøy uten fra/til får dem fra rutekartene her, så nettleseren slipper egne JP-søk
  const liveVehiclesEntry = memoEntry((vehiclesData, etResult, shapes, shapesEntry) => makeJsonEntry(
    buildVehiclesPayload(withRouteInfo(mergeVehicles(vehiclesData, etResult), shapes), {
      shapesVersion: shapesVersionOf(shapesEntry),
    }),
    null,
    { gzipLevel: 9, brQuality: 9, brUpgrade: 10 }
  ));
  // Gamle klienter: hele formatet med path i ms. Bygges bare når noen ber om det.
  const legacyInitialEntry = memoEntry((vehiclesData, etResult, all) => makeJsonEntry({
    vehicles: withoutDelay(mergeVehicles(vehiclesData, etResult)),
    routeShapes: mergeShapes(all, etResult?.shapes ?? NO_SHAPES),
  }));

  let lastEt = null;
  /** Alltid aktive regioner venter på ET (som før); andre svarer med GPS og forrige ET etter høyst etWaitMs. */
  function getEtResult() {
    const p = s.etVehicles.getVehiclesAndShapes().then((r) => { lastEt = r; return r; });
    if (region.alwaysActive) return p;
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => resolve(lastEt ?? NO_ET), etWaitMs);
      timer.unref?.();
    });
    return Promise.race([p.catch(() => lastEt ?? NO_ET), late]).finally(() => clearTimeout(timer));
  }

  async function getLiveSources() {
    const [gps, etResult] = await Promise.all([getGps(region.id), getEtResult()]);
    // Tog i hele landet: GPS uten bbox + ET (BNR) for tog uten GPS. Samme objekt når kildene er uendret.
    const vehiclesData = await withRail(gps);
    return { vehiclesData, etResult };
  }

  async function getLiveEntries() {
    const { vehiclesData, etResult } = await getLiveSources();
    const shapes = liveShapes(
      getAllShapes(),
      etShapesSnapshot(etResult?.shapes ?? NO_SHAPES),
      s.lineGeometry.getShapes(),
      railNetwork.getShapes()
    );
    const shapesEntry = liveShapesEntry(shapes);
    const vehiclesEntry = liveVehiclesEntry(vehiclesData, etResult, shapes, shapesEntry);
    return { vehiclesEntry, shapesEntry, shapesVersion: shapesVersionOf(shapesEntry) };
  }

  async function getLegacyEntry() {
    const { vehiclesData, etResult } = await getLiveSources();
    return legacyInitialEntry(vehiclesData, etResult, getAllShapes());
  }

  /** Avlastet region: slipp forrige ET-resultat og live-svarene bygget av det. Rutekartene beholdes. */
  function drop() {
    lastEt = null;
    liveVehiclesEntry.clear();
    legacyInitialEntry.clear();
  }

  return { getLiveSources, getLiveEntries, getLegacyEntry, getStaticEntry: () => staticEntry(getAllShapes()), getAllShapes, drop };
}

/**
 * @param {object} [o]
 * @param {object[]} [o.regions] synlige regioner
 * @param {object} [o.runtime] createRegionRuntime for de samme regionene
 * @param {(regionId: string) => Promise<object>} [o.getGps] GPS-kjøretøy per region (vehicles-cache.js)
 * @param {() => (data: object) => Promise<object>} [o.createRail] withNationalRail-fabrikk (én per region)
 * @param {{ getShapes: Function, refresh: Function }} [o.railNetwork] togruter i hele landet, felles
 * @param {(region: object) => object[][]} [o.staticShapesFor] statiske rutekart per region
 * @param {(region: object, ctx: object) => object} [o.createServices] tjenestene for én region
 */
export function createRegionRegistry({
  regions = serverVisibleRegions(),
  runtime = createRegionRuntime({ regions }),
  getGps = getCachedVehicles,
  createRail = createNationalRail,
  railNetwork = createRailNetworkService(),
  staticShapesFor = defaultStaticShapes,
  createServices = defaultRegionServices,
  etWaitMs = ET_WAIT_MS,
} = {}) {
  const byId = new Map();
  for (const region of regions) {
    const services = createServices(region, { runtime });
    const live = createLive(region, services, { getGps, withRail: createRail(), railNetwork, staticShapesFor, etWaitMs });
    byId.set(region.id, { region, ...services, live });
  }

  let watching = false;
  /** Avlastet region slipper ET-turene, ET-beregningen og live-svarene (synkron lytter, se region-runtime.js). */
  function watchUnload() {
    if (watching) return;
    watching = true;
    runtime.onUnload((id) => {
      const s = byId.get(id);
      s?.etCache?.drop?.();
      s?.etVehicles?.drop?.();
      s?.live?.drop?.();
    });
  }

  /** ET, rutekart og tilstandssjekk for alle regioner. Kalles én gang ved oppstart. */
  function start({ shapesRefreshMs = SHAPES_REFRESH_MS, tickMs = TICK_MS } = {}) {
    watchUnload();
    setInterval(runtime.tick, tickMs).unref?.();
    for (const s of byId.values()) {
      const id = s.region.id;
      // Én henting uansett tilstand (Oslo straks, andre etter 90 s), deretter bare når aktiv.
      // start() henter gjennom refreshNow(), så en samtidig getJourneys()/refreshNow() deler samme henting.
      const startup = s.etCache.start();
      // Alltid aktive regioner venter selv på første ET i rutekarttjenesten; andre venter på startkallet
      const first = s.region.alwaysActive ? Promise.resolve() : Promise.resolve(startup);
      first
        .then(() => s.shapes.refresh())
        .then((shapes) => console.log(`[RuterLive] Rutekart ${id}: ${shapes?.length ?? 0} linjer`))
        .catch((e) => console.warn(`[RuterLive] Rutekart ${id}:`, e.message));
      setInterval(() => {
        // Hvilende eller avlastet: ingen oppdatering, den ville startet ny ET-henting
        if (runtime.stateOf(id) !== 'active') return;
        s.shapes.refresh().catch((e) => console.warn(`[RuterLive] Rutekart ${id}:`, e.message));
      }, shapesRefreshMs).unref?.();
    }
  }

  return {
    regions,
    runtime,
    railNetwork,
    /** Tjenestene for regionen, eller null for ukjente/skjulte id-er. */
    get: (id) => byId.get(id) ?? null,
    parseRegionParam: (query) => parseRegionParam(query, regions),
    watchUnload,
    start,
  };
}

let defaultRegistry = null;
/** Registeret serveren bruker (synlige regioner fra REGIONS_PREVIEW), opprettet ved første bruk. */
export function getRegistry() {
  if (!defaultRegistry) defaultRegistry = createRegionRegistry();
  return defaultRegistry;
}

/** { region, etCache, etVehicles, shapes, lineGeometry, live } for regionen, eller null. */
export function getRegionServices(id) {
  return getRegistry().get(id);
}
