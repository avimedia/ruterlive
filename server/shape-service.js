/**
 * Server-side rutekarttjeneste. Bygger og cacher route shapes for øyeblikkelig visning.
 * Kjører i bakgrunnen og oppdaterer cache hvert 45. sekund.
 */

import { MAX_ROUTE_SPAN_KM, MAX_ROUTE_SPAN_KM_BUS } from '../config.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { getEtJourneys } from './et-cache.js';
import { ensureGtfsStopsLoaded, getGtfsQuayCache } from './gtfs-stops-loader.js';
import { fetchJpRoutes } from './jp-route-fetcher.js';
import { ensureLineModes, getLineMode } from './line-modes.js';
import { getRegion } from '../shared/regions.js';
import { CLIENT_NAME } from './entur-client.js';

const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';

const MAX_QUAYS_TO_FETCH = 500;
const JP_BATCH_SIZE = 25;

async function fetchJpGraphql(query) {
  const res = await fetchWithRetry(
    JP_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
      body: JSON.stringify({ query }),
    },
    { timeout: 25000 }
  );
  const data = await res.json();
  return data?.data;
}

async function fetchQuayCoordsBatch(quayIds, quayCoordCache, gtfs) {
  const ids = quayIds.filter((id) => /^NSR:Quay:\d+$/.test(id)).slice(0, MAX_QUAYS_TO_FETCH);

  for (const id of ids) {
    if (!quayCoordCache.has(id) && gtfs?.has(id)) {
      quayCoordCache.set(id, gtfs.get(id));
    }
  }

  const toFetch = ids.filter((id) => !quayCoordCache.has(id));
  if (toFetch.length === 0) return;

  for (let i = 0; i < toFetch.length; i += JP_BATCH_SIZE) {
    const batch = toFetch.slice(i, i + JP_BATCH_SIZE);
    const lines = batch.map((id, j) => `q${j}: quay(id: "${id}") { latitude longitude }`).join('\n');
    const data = await fetchJpGraphql(`query { ${lines} }`);
    if (!data) continue;
    batch.forEach((id, j) => {
      const q = data[`q${j}`];
      if (q?.latitude != null && q?.longitude != null) {
        quayCoordCache.set(id, [q.latitude, q.longitude]);
      }
    });
  }
}

/**
 * Linjekode fra lineRef. Ruter: bare tall (som før). Andre regioner: alt etter «:Line:»,
 * siden linjenummer-reglene er Ruter-spesifikke og kodene hos andre operatører kan ha bokstaver.
 */
export function getLinePublicCode(lineRef, region = getRegion()) {
  const re = region.lineNumberFallback === 'ruter' ? /:Line:(\d+)/ : /:Line:([^:\s]+)$/;
  const m = re.exec(lineRef || '');
  return m ? m[1] : '?';
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Fjerner stopp med feil koordinater. Forkaster ruter med 2 punkter og for stor spennvidde. */
function removeGeoOutliers(points, maxNeighborDistKm = MAX_ROUTE_SPAN_KM) {
  if (!points || points.length < 2) return points;

  if (points.length === 2) {
    const dist = haversineKm([points[0][0], points[0][1]], [points[1][0], points[1][1]]);
    if (dist > maxNeighborDistKm) return []; // Ingen mellomstopp, urealistisk – trolig feil data
    return points;
  }

  let current = [...points];

  while (current.length >= 3) {
    let worstDist = 0;
    let outlierIdx = -1;

    for (let i = 0; i < current.length; i++) {
      const pi = [current[i][0], current[i][1]];
      const dPrev = i > 0 ? haversineKm(pi, [current[i - 1][0], current[i - 1][1]]) : 0;
      const dNext = i < current.length - 1 ? haversineKm(pi, [current[i + 1][0], current[i + 1][1]]) : 0;
      const dMax = Math.max(dPrev, dNext);
      if (dMax > worstDist) {
        worstDist = dMax;
        outlierIdx = i;
      }
    }

    if (worstDist <= maxNeighborDistKm) break;
    current.splice(outlierIdx, 1);
  }

  if (current.length === 2 && haversineKm([current[0][0], current[0][1]], [current[1][0], current[1][1]]) > maxNeighborDistKm) {
    return [];
  }
  return current;
}

function buildRouteShapes(journeys, quayCoordCache, region) {
  const seen = new Set();
  const shapes = [];
  const routeModes = new Set(['metro', 'tram', 'water', 'bus']);

  for (const j of journeys) {
    if (!routeModes.has(j.mode)) continue;
    const allCalls = [...j.recordedCalls, ...j.estimatedCalls];
    const points = [];
    const firstQuayId = allCalls[0]?.quayId;
    for (let i = 0; i < allCalls.length; i++) {
      const c = allCalls[i];
      const coords = quayCoordCache.get(c.quayId);
      if (!coords) continue;
      // Sirkelruter: ikke tegne linje tilbake til start – stopp ved siste stopp
      if (i === allCalls.length - 1 && c.quayId === firstQuayId) break;
      points.push([coords[0], coords[1], c.quayId, c.name || '']);
    }
    const maxSpanKm = j.mode === 'bus' || j.mode === 'water' ? MAX_ROUTE_SPAN_KM_BUS : MAX_ROUTE_SPAN_KM;
    const cleanedPoints = removeGeoOutliers(points, maxSpanKm);
    const minPoints = j.mode === 'metro' ? 5 : 3; // T-bane: mange stopp; buss/trikk/båt: min 3 for å unngå rette streker
    if (cleanedPoints.length < minPoints) continue;
    const key = cleanedPoints.map((p) => `${Number(p[0]).toFixed(4)},${Number(p[1]).toFixed(4)}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);

    const first = allCalls[0];
    const last = allCalls[allCalls.length - 1];
    const midIdx = Math.floor(allCalls.length / 2);
    const viaStop = allCalls.length > 2 ? allCalls[midIdx]?.name : null;

    shapes.push({
      mode: j.mode,
      line: getLinePublicCode(j.lineRef, region),
      from: first?.name || '',
      to: last?.name || '',
      via: viaStop || null,
      points: cleanedPoints,
    });
  }
  return shapes;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 døgn

/**
 * Rutekarttjeneste for én region. JP-togruter fra Oslo S hentes bare når region.jpRailFallback.
 * @param {{ region: object, etCache: { getJourneys: Function }, deps?: object }} opts
 *   deps kan overstyre eksterne avhengigheter (tester).
 */
export function createShapeService({ region, etCache, deps = {} }) {
  const {
    ensureGtfs = deps.ensureGtfsStopsLoaded ?? ensureGtfsStopsLoaded,
    getGtfs = deps.getGtfsQuayCache ?? getGtfsQuayCache,
    ensureModes = deps.ensureLineModes ?? ensureLineModes,
    lineMode = deps.getLineMode ?? getLineMode,
    fetchJp = deps.fetchJpRoutes ?? fetchJpRoutes,
    now = deps.now ?? Date.now,
  } = {};
  const quayCoordCache = new Map();
  let cachedShapes = [];
  let lastFetch = 0;

  const isCacheFresh = () => cachedShapes.length > 0 && now() - lastFetch < CACHE_TTL_MS;

  async function refresh() {
    if (isCacheFresh()) return cachedShapes;
    let shapes = [];
    const jpPromise = region.jpRailFallback === true
      ? fetchJp(quayCoordCache).catch((err) => {
          console.warn('[RuterLive] JP routes fetch:', err.message);
          return [];
        })
      : Promise.resolve([]);

    await ensureGtfs();

    try {
      // Delte, frosne turer fra et-cache – lag kopi ved ny modus i stedet for å mutere
      const parsed = await etCache.getJourneys();

      const uniqueLineRefs = [...new Set(parsed.map((j) => j.lineRef).filter(Boolean))];
      await ensureModes(uniqueLineRefs);

      const journeys = [];
      for (const j of parsed) {
        const jpMode = lineMode(j.lineRef);
        const withMode = jpMode && jpMode !== j.mode ? { ...j, mode: jpMode } : j;
        if (withMode.mode) journeys.push(withMode); // ukjent modus også etter JP: droppes
      }

      const quayToMode = new Map();
      for (const j of journeys) {
        for (const c of [...j.recordedCalls, ...j.estimatedCalls]) {
          if (c?.quayId) quayToMode.set(c.quayId, j.mode);
        }
      }
      const quayIds = [...quayToMode.entries()]
        .sort((a, b) => {
          const pm = (m) => (m === 'metro' ? 0 : m === 'tram' ? 1 : 2);
          return pm(a[1]) - pm(b[1]);
        })
        .map(([id]) => id)
        .slice(0, MAX_QUAYS_TO_FETCH);
      await fetchQuayCoordsBatch(quayIds, quayCoordCache, getGtfs());

      shapes = buildRouteShapes(journeys, quayCoordCache, region);
    } catch (err) {
      console.warn('[RuterLive] shape-service ET:', err.message);
    }

    const jpShapes = await jpPromise;
    shapes = [...shapes, ...jpShapes];

    if (shapes.length > 0) {
      cachedShapes = shapes;
      lastFetch = now();
    }
    return cachedShapes;
  }

  return { getCachedShapes: () => cachedShapes, isCacheFresh, refresh };
}

// Oslo-instans for server.js
const oslo = createShapeService({ region: getRegion('oslo'), etCache: { getJourneys: getEtJourneys } });
export const getCachedShapes = () => oslo.getCachedShapes();
export const isCacheFresh = () => oslo.isCacheFresh();
export const refreshRouteShapes = () => oslo.refresh();
