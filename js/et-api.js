/**
 * SIRI ET (Estimated Timetable) – beregnet posisjon for buss, T-bane, trikk og båt.
 * Ruter leverer ikke GPS til Entur, så vi interpolerer mellom stopp basert på avgangsdata.
 */

import { MAX_ROUTE_SPAN_KM } from '../config.js';

const ET_URL = import.meta.env.DEV ? '/api/entur-et/et?datasetId=RUT&maxSize=3000' : '/api/et-cached';
const JP_GRAPHQL_URL = '/api/entur-jp/graphql';
const CLIENT_NAME = 'ruterlive-web';
const RETRY_DELAYS = [2000, 4000, 8000]; // Backoff ved 502/503 (cold start)

// Fallback ved manglende JP-data: T-bane 1–6, Trikk 11–19, resten buss (linjenummer er upålitelig for båt)
const METRO_LINE_NUMS = new Set([1, 2, 3, 4, 5, 6]);
const TRAM_LINE_NUMS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19]);

const quayCoordCache = new Map();
const lineModeCache = new Map(); // lineRef -> 'bus'|'metro'|'tram'|'water'|'rail'|null

function getLineNum(lineRef) {
  const m = /:Line:(\d+)/.exec(lineRef || '');
  return m ? parseInt(m[1], 10) : null;
}

/** Fallback når JP ikke har transportmodus. Unngår 90–99/390–399 som båt – linjenumre er upålitelige. */
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

const MAX_QUAYS_TO_FETCH = 500; // Flere holdeplasser = flere busser med beregnet posisjon

const JP_BATCH_SIZE = 25; // Større batch = færre requests

const QUAY_COORDS_URL = '/api/quay-coords';

async function fetchQuayCoordsFromServer(quayIds) {
  const ids = quayIds.filter((id) => /^NSR:Quay:\d+$/.test(id));
  if (ids.length === 0) return new Map();
  try {
    const res = await fetch(QUAY_COORDS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return new Map();
    const data = await res.json();
    const out = new Map();
    for (const [id, coords] of Object.entries(data || {})) {
      if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        out.set(id, [coords[0], coords[1]]);
      }
    }
    return out;
  } catch (_) {
    return new Map();
  }
}

async function fetchQuayCoordsFromJpBatch(quayIds) {
  const ids = quayIds.filter((id) => /^NSR:Quay:\d+$/.test(id));
  if (ids.length === 0) return new Map();
  const lines = ids.map((id, i) => `q${i}: quay(id: "${id}") { latitude longitude }`).join("\n");
  const query = `query { ${lines} }`;
  try {
    const res = await fetch(JP_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ET-Client-Name': CLIENT_NAME,
      },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!data?.data) return new Map();
    const out = new Map();
    ids.forEach((id, i) => {
      const q = data.data[`q${i}`];
      if (q?.latitude != null && q?.longitude != null) {
        out.set(id, [q.latitude, q.longitude]);
      }
    });
    return out;
  } catch (_) {
    return new Map();
  }
}

/** Henter koordinater for holdeplass – kun ID-basert (JP). Ingen navnesøk (Geocoder) siden mange stopp har samme navn. */
async function getQuayCoords(quayId) {
  if (quayCoordCache.has(quayId)) {
    return quayCoordCache.get(quayId);
  }
  if (!/^NSR:Quay:\d+$/.test(quayId)) return null;
  try {
    const coords = await fetchQuayCoordsFromJpBatch([quayId]);
    const c = coords.get(quayId);
    if (c) return c;
  } catch (_) {}
  return null;
}

function parseIsoTime(str) {
  if (!str) return null;
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d.getTime();
}

const SIRI_NS = 'http://www.siri.org.uk/siri';

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

const LINE_MODE_BATCH_SIZE = 20;

async function fetchLineModesBatch(lineRefs) {
  const toFetch = lineRefs.filter((ref) => ref && !lineModeCache.has(ref)).slice(0, LINE_MODE_BATCH_SIZE);
  if (toFetch.length === 0) return;
  const lines = toFetch.map((id, i) => `l${i}: line(id: "${id}") { transportMode }`).join('\n');
  const query = `query { ${lines} }`;
  try {
    const res = await fetch(JP_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
      body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!data?.data) return;
    toFetch.forEach((ref, i) => {
      const line = data.data[`l${i}`];
      const mode = mapJpTransportMode(line?.transportMode);
      lineModeCache.set(ref, mode);
    });
  } catch (_) {}
}

async function fetchQuayCoordsBatch(quays) {
  const toFetch = quays.filter(({ quayId }) => !quayCoordCache.has(quayId));
  if (toFetch.length === 0) return;
  const nsrQuays = toFetch.filter(({ quayId }) => /^NSR:Quay:\d+$/.test(quayId));
  for (let i = 0; i < nsrQuays.length; i += JP_BATCH_SIZE) {
    const batch = nsrQuays.slice(i, i + JP_BATCH_SIZE).map(({ quayId }) => quayId);
    const coords = await fetchQuayCoordsFromJpBatch(batch);
    coords.forEach((c, id) => quayCoordCache.set(id, c));
  }
  const remaining = toFetch.filter(({ quayId }) => !quayCoordCache.has(quayId));
  const CONCURRENCY = 4;
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(({ quayId }) => getQuayCoords(quayId)));
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function fetchEstimatedVehicles(onProgress) {
  try {
    let res;
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      res = await fetch(ET_URL, { headers: { 'ET-Client-Name': CLIENT_NAME } });
      if (res.ok) break;
      if ((res.status === 502 || res.status === 503) && attempt < RETRY_DELAYS.length) {
        await delay(RETRY_DELAYS[attempt]);
        continue;
      }
      throw new Error(`ET API ${res.status}`);
    }
    const xml = await res.text();
    const journeys = parseSiriXml(xml);

    const uniqueLineRefs = [...new Set(journeys.map((j) => j.lineRef).filter(Boolean))];
    await fetchLineModesBatch(uniqueLineRefs);

    for (const j of journeys) {
      const jpMode = lineModeCache.get(j.lineRef);
      if (jpMode) j.mode = jpMode;
    }

    const quaysToFetch = new Map();
    const metroQuays = new Set();
    const tramQuays = new Set();
    for (const j of journeys) {
      const quays = [...j.recordedCalls, ...j.estimatedCalls].filter((c) => c?.quayId);
      for (const c of quays) {
        quaysToFetch.set(c.quayId, c.name);
        if (j.mode === 'metro') metroQuays.add(c.quayId);
        else if (j.mode === 'tram') tramQuays.add(c.quayId);
      }
    }
    const entries = [...quaysToFetch.entries()];
    const sorted = entries.sort((a, b) => {
      const [idA, idB] = [a[0], b[0]];
      if (metroQuays.has(idA) && !metroQuays.has(idB)) return -1;
      if (!metroQuays.has(idA) && metroQuays.has(idB)) return 1;
      if (tramQuays.has(idA) && !tramQuays.has(idB)) return -1;
      if (!tramQuays.has(idA) && tramQuays.has(idB)) return 1;
      return 0;
    });
    const quayList = sorted
      .map(([quayId, name]) => ({ quayId, name }))
      .slice(0, MAX_QUAYS_TO_FETCH);
    const quayIds = quayList.map((q) => q.quayId).filter(Boolean);
    const serverCoords = await fetchQuayCoordsFromServer(quayIds);
    for (const [id, coords] of serverCoords) {
      quayCoordCache.set(id, coords);
    }
    const stillMissing = quayList.filter((q) => !quayCoordCache.has(q.quayId));
    await fetchQuayCoordsBatch(stillMissing);

    const now = Date.now();
    const vehicles = [];

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
      } else if (lastRecorded && j.estimatedCalls.length === 0) {
        fromCall = lastRecorded;
      }

      const fromCoords = fromCall ? quayCoordCache.get(fromCall.quayId) ?? await getQuayCoords(fromCall.quayId) : null;
      const toCoords = toCall ? quayCoordCache.get(toCall.quayId) ?? await getQuayCoords(toCall.quayId) : null;

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
        const viaStop = allCalls.length > 2 ? allCalls[midIdx]?.name : null;
        const endStation = j.destinationName || last?.name || null;
        const nextStop = toCall?.name && toCall.name !== endStation ? toCall.name : null;
        const originForFrom = j.mode === 'bus' ? first?.name : (fromCall?.name || first?.name);
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
          via: viaStop || null,
        });
      }
    }

    const routeShapes = buildRouteShapes(journeys);
    // OSRM (veifølgende geometri) deaktivert – offentlig server gir ofte 500/429

    if (import.meta.env.DEV) {
      console.debug('[RuterLive] ET result:', { vehicles: vehicles.length, routeShapes: routeShapes.length, quayCacheSize: quayCoordCache.size });
    }
    if (onProgress) onProgress(vehicles.length);
    return { vehicles, routeShapes };
  } catch (err) {
    console.warn('ET fetch error:', err);
    return { vehicles: [], routeShapes: [] };
  }
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
    if (haversineKm(points[0], points[1]) > maxNeighborDistKm) return [];
    return points;
  }

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

  if (current.length === 2 && haversineKm(current[0], current[1]) > maxNeighborDistKm) {
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
      points.push(coords);
    }
    const cleanedPoints = removeGeoOutliers(points);
    const minPoints = j.mode === 'metro' ? 5 : 3; // T-bane: mange stopp; buss/trikk/båt: min 3 for å unngå rette streker
    if (cleanedPoints.length < minPoints) continue;
    const key = cleanedPoints.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join('|');
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
  if (import.meta.env.DEV && shapes.length > 0) {
    console.debug('[RuterLive] routeShapes:', shapes.length, 'avg points:', (shapes.reduce((s, sh) => s + sh.points.length, 0) / shapes.length).toFixed(0));
  }
  return shapes;
}
