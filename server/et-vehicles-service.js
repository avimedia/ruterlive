/**
 * Server-side ET-tjeneste: beregner kjøretøyposisjoner og rutekart fra SIRI ET.
 * Bruker GTFS for quay-koordinater – ingen avhengighet til JP batches.
 * Cache 15s siden posisjoner beregnes ut fra "nå".
 */

import { DOMParser } from '@xmldom/xmldom';
import { MAX_ROUTE_SPAN_KM, MAX_ROUTE_SPAN_KM_BUS } from '../config.js';
import { ensureEtCache } from './et-cache.js';
import { ensureGtfsStopsLoaded, getGtfsQuayCache } from './gtfs-stops-loader.js';
import { fetchWithRetry } from './fetch-with-retry.js';

const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const CLIENT_NAME = 'ruterlive-web';

const METRO_LINE_NUMS = new Set([1, 2, 3, 4, 5, 6]);
const TRAM_LINE_NUMS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19]);
const SIRI_NS = 'http://www.siri.org.uk/siri';

const CACHE_TTL_MS = 15000; // 15s – posisjoner avhenger av "nå"

let cached = null;
let lastCompute = 0;

function getLineNum(lineRef) {
  const m = /:Line:(\d+)/.exec(lineRef || '');
  return m ? parseInt(m[1], 10) : null;
}

function getModeFromLineNumFallback(lineRef) {
  const num = getLineNum(lineRef);
  if (!num) return null;
  if (METRO_LINE_NUMS.has(num)) return 'metro';
  if (TRAM_LINE_NUMS.has(num)) return 'tram';
  if (num >= 20) return 'bus';
  return null;
}

function mapJpTransportMode(jpMode) {
  if (!jpMode) return null;
  const m = (typeof jpMode === 'object' ? jpMode?.name ?? jpMode?.transportMode : jpMode).toString().toLowerCase();
  if (['metro', 'bus', 'tram', 'water', 'rail'].includes(m)) return m;
  if (['ferry', 'ferje'].includes(m)) return 'water';
  return null;
}

function parseIsoTime(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.getTime();
}

function parseSiriXml(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const journeys = [];

  const journeyEls = doc.getElementsByTagNameNS(SIRI_NS, 'EstimatedVehicleJourney');
  for (let i = 0; i < journeyEls.length; i++) {
    const jel = journeyEls[i];
    const lineRef = jel.getElementsByTagNameNS(SIRI_NS, 'LineRef')[0]?.textContent;
    const mode = getModeFromLineNumFallback(lineRef);
    if (!mode) continue;

    const vehicleRef = jel.getElementsByTagNameNS(SIRI_NS, 'VehicleRef')[0]?.textContent || '';
    const destEl = jel.getElementsByTagNameNS(SIRI_NS, 'DestinationDisplay')[0];
    const destinationName = (destEl?.textContent || '').trim();

    const recordedCalls = [];
    const rcEls = jel.getElementsByTagNameNS(SIRI_NS, 'RecordedCall');
    for (let r = 0; r < rcEls.length; r++) {
      const cel = rcEls[r];
      const ref = cel.getElementsByTagNameNS(SIRI_NS, 'StopPointRef')[0]?.textContent;
      const name = cel.getElementsByTagNameNS(SIRI_NS, 'StopPointName')[0]?.textContent || '';
      const dep = parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ActualDepartureTime')[0]?.textContent)
        || parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ActualArrivalTime')[0]?.textContent);
      if (ref && dep) recordedCalls.push({ quayId: ref, name, time: dep });
    }

    const estimatedCalls = [];
    const ecEls = jel.getElementsByTagNameNS(SIRI_NS, 'EstimatedCall');
    for (let e = 0; e < ecEls.length; e++) {
      const cel = ecEls[e];
      const ref = cel.getElementsByTagNameNS(SIRI_NS, 'StopPointRef')[0]?.textContent;
      const name = cel.getElementsByTagNameNS(SIRI_NS, 'StopPointName')[0]?.textContent || '';
      const arr = parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ExpectedArrivalTime')[0]?.textContent)
        || parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ExpectedDepartureTime')[0]?.textContent);
      const dep = parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ExpectedDepartureTime')[0]?.textContent);
      if (ref && (arr || dep)) {
        estimatedCalls.push({ quayId: ref, name, arrTime: arr || dep, depTime: dep || arr });
      }
    }

    if (recordedCalls.length === 0 && estimatedCalls.length === 0) continue;

    journeys.push({
      vehicleId: vehicleRef || `et-${lineRef}-${journeys.length}`,
      mode,
      lineRef,
      destinationName,
      recordedCalls,
      estimatedCalls,
    });
  }
  return journeys;
}

function getLinePublicCode(lineRef) {
  const m = /:Line:(\d+)/.exec(lineRef || '');
  return m ? m[1] : '?';
}

async function fetchLineModes(lineRefs, lineModeCache) {
  const toFetch = lineRefs.filter((ref) => ref && !lineModeCache.has(ref)).slice(0, 20);
  if (toFetch.length === 0) return;
  const lines = toFetch.map((id, i) => `l${i}: line(id: "${id}") { transportMode }`).join('\n');
  try {
    const res = await fetchWithRetry(
      JP_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
        body: JSON.stringify({ query: `query { ${lines} }` }),
      },
      { timeout: 15000 }
    );
    const data = (await res.json())?.data;
    if (!data) return;
    toFetch.forEach((ref, i) => {
      const line = data[`l${i}`];
      const mode = mapJpTransportMode(line?.transportMode);
      if (mode) lineModeCache.set(ref, mode);
    });
  } catch (_) {}
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

function buildVehiclesAndShapes(journeys, quayCoordCache) {
  const now = Date.now();
  const vehicles = [];
  const routeModes = new Set(['metro', 'tram', 'water', 'bus']);

  for (const j of journeys) {
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
      vehicles.push({
        vehicleId: j.vehicleId,
        mode: j.mode,
        location: { latitude: lat, longitude: lon },
        line: { publicCode: getLinePublicCode(j.lineRef) },
        destinationName: j.destinationName,
        bearing: null,
        from: fromCall?.name || first?.name || null,
        to: toCall?.name || last?.name || j.destinationName || null,
        nextStop,
        via: allCalls.length > 2 ? allCalls[midIdx]?.name : null,
      });
    }

  }

  const shapes = [];
  const shapeSeen = new Set();
  for (const j of journeys) {
    if (!routeModes.has(j.mode)) continue;
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

  return { vehicles, shapes };
}

export async function getEtVehiclesAndShapes() {
  if (cached && Date.now() - lastCompute < CACHE_TTL_MS) {
    return cached;
  }

  try {
    await ensureGtfsStopsLoaded();
    const gtfs = getGtfsQuayCache();
    if (!gtfs || gtfs.size === 0) {
      if (cached) return cached;
      return { vehicles: [], shapes: [] };
    }

    const xml = await ensureEtCache();
    const journeys = parseSiriXml(xml);

    const lineModeCache = new Map();
    const uniqueLineRefs = [...new Set(journeys.map((j) => j.lineRef).filter(Boolean))];
    await fetchLineModes(uniqueLineRefs, lineModeCache);
    for (const j of journeys) {
      const jpMode = lineModeCache.get(j.lineRef);
      if (jpMode) j.mode = jpMode;
    }

    const quayCoordCache = new Map();
    for (const j of journeys) {
      for (const c of [...j.recordedCalls, ...j.estimatedCalls]) {
        if (c?.quayId && gtfs.has(c.quayId)) {
          quayCoordCache.set(c.quayId, gtfs.get(c.quayId));
        }
      }
    }

    const result = buildVehiclesAndShapes(journeys, quayCoordCache);
    cached = result;
    lastCompute = Date.now();
    return result;
  } catch (err) {
    console.warn('[RuterLive] ET vehicles:', err.message);
    if (cached) return cached;
    return { vehicles: [], shapes: [] };
  }
}
