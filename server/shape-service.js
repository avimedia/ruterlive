/**
 * Server-side rutekarttjeneste. Bygger og cacher route shapes for øyeblikkelig visning.
 * Kjører i bakgrunnen og oppdaterer cache hvert 45. sekund.
 */

import { MAX_ROUTE_SPAN_KM, MAX_ROUTE_SPAN_KM_BUS } from '../config.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { getEtJourneys } from './et-cache.js';
import { ensureGtfsStopsLoaded, getGtfsQuayCache } from './gtfs-stops-loader.js';
import { fetchJpRoutes } from './jp-route-fetcher.js';

const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const CLIENT_NAME = 'ruterlive-web';

const MAX_QUAYS_TO_FETCH = 500;
const JP_BATCH_SIZE = 25;

const quayCoordCache = new Map();
const lineModeCache = new Map();

function mapJpTransportMode(jpMode) {
  if (!jpMode) return null;
  const m = (typeof jpMode === 'object' ? jpMode?.name ?? jpMode?.transportMode : jpMode).toString().toLowerCase();
  if (['metro', 'bus', 'tram', 'water', 'rail'].includes(m)) return m;
  if (['ferry', 'ferje'].includes(m)) return 'water';
  return null;
}

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

async function fetchQuayCoordsBatch(quayIds) {
  const gtfs = getGtfsQuayCache();
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

async function fetchLineModes(lineRefs) {
  const toFetch = lineRefs.filter((ref) => ref && !lineModeCache.has(ref)).slice(0, 20);
  if (toFetch.length === 0) return;

  const lines = toFetch.map((id, i) => `l${i}: line(id: "${id}") { transportMode }`).join('\n');
  const data = await fetchJpGraphql(`query { ${lines} }`);
  if (!data) return;

  toFetch.forEach((ref, i) => {
    const line = data[`l${i}`];
    const mode = mapJpTransportMode(line?.transportMode);
    lineModeCache.set(ref, mode);
  });
}

function getLinePublicCode(lineRef) {
  const m = /:Line:(\d+)/.exec(lineRef || '');
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

function buildRouteShapes(journeys) {
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
      line: getLinePublicCode(j.lineRef),
      from: first?.name || '',
      to: last?.name || '',
      via: viaStop || null,
      points: cleanedPoints,
    });
  }
  return shapes;
}

let cachedShapes = [];
let lastFetch = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 1 døgn

export function getCachedShapes() {
  return cachedShapes;
}

export function isCacheFresh() {
  return cachedShapes.length > 0 && Date.now() - lastFetch < CACHE_TTL_MS;
}

export async function refreshRouteShapes() {
  if (isCacheFresh()) return cachedShapes;
  let shapes = [];
  const jpPromise = fetchJpRoutes(quayCoordCache).catch((err) => {
    console.warn('[RuterLive] JP routes fetch:', err.message);
    return [];
  });

  await ensureGtfsStopsLoaded();

  try {
    // Delte, frosne turer fra et-cache – lag kopi ved ny modus i stedet for å mutere
    const parsed = await getEtJourneys();

    const uniqueLineRefs = [...new Set(parsed.map((j) => j.lineRef).filter(Boolean))];
    await fetchLineModes(uniqueLineRefs);

    const journeys = parsed.map((j) => {
      const jpMode = lineModeCache.get(j.lineRef);
      return jpMode && jpMode !== j.mode ? { ...j, mode: jpMode } : j;
    });

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
    await fetchQuayCoordsBatch(quayIds);

    shapes = buildRouteShapes(journeys);
  } catch (err) {
    console.warn('[RuterLive] shape-service ET:', err.message);
  }

  const jpShapes = await jpPromise;
  shapes = [...shapes, ...jpShapes];

  if (shapes.length > 0) {
    cachedShapes = shapes;
    lastFetch = Date.now();
  }
  return cachedShapes;
}
