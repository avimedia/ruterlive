/**
 * Server-side ET-tjeneste: beregner kjøretøyposisjoner og rutekart fra SIRI ET.
 * Bruker GTFS for quay-koordinater – ingen avhengighet til JP batches.
 * Cache 15s siden posisjoner beregnes ut fra "nå".
 */

import { MAX_ROUTE_SPAN_KM, MAX_ROUTE_SPAN_KM_BUS } from '../config.js';
import { selectJourneysForVehicles } from '../shared/et-journeys.js';
import { buildVehiclePath } from '../shared/vehicle-path.js';
import { getEtJourneys, getEtVersion } from './et-cache.js';
import { ensureGtfsStopsLoaded, getGtfsQuayCache } from './gtfs-stops-loader.js';
import { ensureLineModes, getLineMode } from './line-modes.js';
import { dedupeInFlight } from './in-flight.js';

const CACHE_TTL_MS = 15000; // 15s – posisjoner avhenger av "nå"

let cached = null;
let lastCompute = 0;
let shapesKey = { etVersion: -1, gtfs: null };
// Samme tomme resultat hver gang, så server.js kan gjenbruke ferdigkomprimerte svar ved feil
const EMPTY = Object.freeze({ vehicles: Object.freeze([]), shapes: Object.freeze([]) });

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

function removeGeoOutliers(points, maxNeighborDistKm = MAX_ROUTE_SPAN_KM) {
  if (!points || points.length < 2) return points;
  const p0 = [points[0][0], points[0][1]];
  const p1 = [points[1][0], points[1][1]];
  if (points.length === 2 && haversineKm(p0, p1) > maxNeighborDistKm) return [];
  if (points.length === 2) return points;

  let current = [...points];
  while (current.length >= 3) {
    let worstDist = 0;
    let outlierIdx = -1;
    for (let i = 0; i < current.length; i++) {
      const dPrev = i > 0 ? haversineKm(current[i], current[i - 1]) : 0;
      const dNext = i < current.length - 1 ? haversineKm(current[i], current[i + 1]) : 0;
      const dMax = Math.max(dPrev, dNext);
      if (dMax > worstDist) {
        worstDist = dMax;
        outlierIdx = i;
      }
    }
    if (worstDist <= maxNeighborDistKm) break;
    current.splice(outlierIdx, 1);
  }
  if (current.length === 2 && haversineKm(current[0], current[1]) > maxNeighborDistKm) return [];
  return current;
}

const ROUTE_MODES = new Set(['metro', 'tram', 'water', 'bus']);

/** prevShapes: rutekart fra samme ET-versjon gjenbrukes (samme array → ingen ny serialisering). */
function buildVehiclesAndShapes(journeys, quayCoordCache, prevShapes = null) {
  const now = Date.now();
  const vehicles = [];

  // Bare én tur per kjøretøy (ikke fullførte eller ikke-startede turer), men shapes bygges fra alle turer
  for (const j of selectJourneysForVehicles(journeys, now)) {
    let fromCall = null;
    let toCall = null;
    const lastRecorded = j.recordedCalls[j.recordedCalls.length - 1];
    const firstEstimated = j.estimatedCalls[0];
    const secondEstimated = j.estimatedCalls[1];

    if (lastRecorded && firstEstimated) {
      fromCall = lastRecorded;
      toCall = firstEstimated;
    } else if (firstEstimated && secondEstimated && j.recordedCalls.length === 0) {
      const tFirstDep = firstEstimated.depTime || firstEstimated.arrTime;
      const tSecondArr = secondEstimated.arrTime || secondEstimated.depTime;
      if (now >= tFirstDep && tSecondArr > tFirstDep) {
        fromCall = { ...firstEstimated, time: tFirstDep };
        toCall = secondEstimated;
      } else {
        toCall = firstEstimated;
      }
    } else if (firstEstimated && j.recordedCalls.length === 0) {
      toCall = firstEstimated;
    } else if (lastRecorded && j.recordedCalls.length > 0 && j.estimatedCalls.length === 0) {
      fromCall = lastRecorded;
    }

    const fromCoords = fromCall ? quayCoordCache.get(fromCall.quayId) : null;
    const toCoords = toCall ? quayCoordCache.get(toCall.quayId) : null;

    let lat = null;
    let lon = null;
    if (fromCoords && toCoords && fromCall && toCall) {
      const tFrom = fromCall.time ?? fromCall.depTime ?? fromCall.arrTime;
      const tTo = toCall.arrTime || toCall.depTime || tFrom + 60000;
      const progress = Math.max(0, Math.min(1, (now - tFrom) / (tTo - tFrom)));
      lat = fromCoords[0] + progress * (toCoords[0] - fromCoords[0]);
      lon = fromCoords[1] + progress * (toCoords[1] - fromCoords[1]);
    } else if (toCoords) {
      lat = toCoords[0];
      lon = toCoords[1];
    } else if (fromCoords) {
      lat = fromCoords[0];
      lon = fromCoords[1];
    }

    if (lat != null && lon != null) {
      const allCalls = [...j.recordedCalls, ...j.estimatedCalls];
      const first = allCalls[0];
      const last = allCalls[allCalls.length - 1];
      const midIdx = Math.floor(allCalls.length / 2);
      const endStation = j.destinationName || last?.name || null;
      const nextStop = toCall?.name && toCall.name !== endStation ? toCall.name : null;
      const originForFrom = j.mode === 'bus' ? first?.name : (fromCall?.name || first?.name);
      // Siste passerte + tre neste stopp med tider, så klienten kan flytte kjøretøyet jevnt
      const path = buildVehiclePath(j.recordedCalls, j.estimatedCalls, (q) => quayCoordCache.get(q), {
        maxHopKm: j.mode === 'bus' || j.mode === 'water' ? MAX_ROUTE_SPAN_KM_BUS : MAX_ROUTE_SPAN_KM,
      });
      vehicles.push({
        vehicleId: j.vehicleId,
        mode: j.mode,
        location: { latitude: lat, longitude: lon },
        line: { publicCode: getLinePublicCode(j.lineRef) },
        destinationName: j.destinationName,
        bearing: null,
        from: originForFrom || null,
        to: toCall?.name || last?.name || j.destinationName || null,
        nextStop,
        via: allCalls.length > 2 ? allCalls[midIdx]?.name : null,
        ...(path ? { path } : {}),
      });
    }

  }

  return { vehicles, shapes: prevShapes ?? buildShapes(journeys, quayCoordCache) };
}

function buildShapes(journeys, quayCoordCache) {
  const shapes = [];
  const shapeSeen = new Set();
  for (const j of journeys) {
    if (!ROUTE_MODES.has(j.mode)) continue;
    const allCalls = [...j.recordedCalls, ...j.estimatedCalls];
    const points = [];
    const firstQuayId = allCalls[0]?.quayId;
    for (let i = 0; i < allCalls.length; i++) {
      const c = allCalls[i];
      const coords = quayCoordCache.get(c.quayId);
      if (!coords) continue;
      if (i === allCalls.length - 1 && c.quayId === firstQuayId) break;
      points.push([coords[0], coords[1], c.quayId, c.name || '']);
    }
    const maxSpanKm = j.mode === 'bus' || j.mode === 'water' ? MAX_ROUTE_SPAN_KM_BUS : MAX_ROUTE_SPAN_KM;
    const cleanedPoints = removeGeoOutliers(points, maxSpanKm);
    const minPoints = j.mode === 'metro' ? 5 : 3;
    if (cleanedPoints.length < minPoints) continue;
    const key = cleanedPoints.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join('|');
    if (shapeSeen.has(key)) continue;
    shapeSeen.add(key);

    const first = allCalls[0];
    const last = allCalls[allCalls.length - 1];
    const midIdx = Math.floor(allCalls.length / 2);
    shapes.push({
      mode: j.mode,
      line: getLinePublicCode(j.lineRef),
      from: first?.name || '',
      to: last?.name || '',
      via: allCalls.length > 2 ? allCalls[midIdx]?.name : null,
      points: cleanedPoints,
    });
  }

  return shapes;
}

export async function getEtVehiclesAndShapes() {
  if (cached && Date.now() - lastCompute < CACHE_TTL_MS) {
    return cached;
  }
  // Avviser aldri: ved tidsavbrudd brukes forrige resultat, som før.
  return computeDeduped().catch((e) => {
    console.warn('[RuterLive] ET vehicles:', e.message);
    return cached ?? EMPTY;
  });
}

const computeDeduped = dedupeInFlight(async () => {
  try {
    await ensureGtfsStopsLoaded();
    const gtfs = getGtfsQuayCache();
    if (!gtfs || gtfs.size === 0) {
      if (cached) return cached;
      return EMPTY;
    }

    // Delte, frosne turer fra et-cache – lag kopi ved ny modus i stedet for å mutere
    const parsed = await getEtJourneys();
    const etVersion = getEtVersion();

    // Delt cache (24 t, feil 10 min): JP-kall bare for nye linjer, ikke hvert 15. s
    const uniqueLineRefs = [...new Set(parsed.map((j) => j.lineRef).filter(Boolean))];
    await ensureLineModes(uniqueLineRefs);
    const journeys = parsed.map((j) => {
      const jpMode = getLineMode(j.lineRef);
      return jpMode && jpMode !== j.mode ? { ...j, mode: jpMode } : j;
    });

    const quayCoordCache = new Map();
    for (const j of journeys) {
      for (const c of [...j.recordedCalls, ...j.estimatedCalls]) {
        if (c?.quayId && gtfs.has(c.quayId)) {
          quayCoordCache.set(c.quayId, gtfs.get(c.quayId));
        }
      }
    }

    const sameShapes = cached && shapesKey.etVersion === etVersion && shapesKey.gtfs === gtfs;
    const result = buildVehiclesAndShapes(journeys, quayCoordCache, sameShapes ? cached.shapes : null);
    shapesKey = { etVersion, gtfs };
    cached = result;
    lastCompute = Date.now();
    return result;
  } catch (err) {
    console.warn('[RuterLive] ET vehicles:', err.message);
    if (cached) return cached;
    return EMPTY;
  }
}, { timeoutMs: 60000 }); // ET-beregning: maks 1 min, deretter nytt forsøk
