/**
 * Server-side rutekarttjeneste. Bygger og cacher route shapes for øyeblikkelig visning.
 * Kjører i bakgrunnen og oppdaterer cache hvert 45. sekund.
 */

import { DOMParser } from '@xmldom/xmldom';

const ET_URL = 'https://api.entur.io/realtime/v1/rest/et?datasetId=RUT&maxSize=2000';
const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const OSRM_URL = 'https://router.project-osrm.org';
const CLIENT_NAME = 'ruterlive-web';

const METRO_LINE_NUMS = new Set([1, 2, 3, 4, 5, 6]);
const TRAM_LINE_NUMS = new Set([11, 12, 13, 14, 15, 16, 17, 18, 19]);
const MAX_QUAYS_TO_FETCH = 350;
const JP_BATCH_SIZE = 25;
const MAX_WAYPOINTS = 50;

const quayCoordCache = new Map();
const lineModeCache = new Map();
const osrmCache = new Map();

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

async function fetchEtXml() {
  const res = await fetch(ET_URL, { headers: { 'ET-Client-Name': CLIENT_NAME } });
  if (!res.ok) throw new Error(`ET ${res.status}`);
  return res.text();
}

async function fetchJpGraphql(query) {
  const res = await fetch(JP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
    body: JSON.stringify({ query }),
  });
  const data = await res.json();
  return data?.data;
}

async function fetchQuayCoordsBatch(quayIds) {
  const ids = quayIds.filter((id) => /^NSR:Quay:\d+$/.test(id)).slice(0, MAX_QUAYS_TO_FETCH);
  if (ids.length === 0) return;

  for (let i = 0; i < ids.length; i += JP_BATCH_SIZE) {
    const batch = ids.slice(i, i + JP_BATCH_SIZE);
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

async function getOsrmGeometry(coords) {
  if (!coords || coords.length < 2) return null;

  const key = coords.map(([lat, lon]) => `${lat.toFixed(4)},${lon.toFixed(4)}`).join(';');
  if (osrmCache.has(key)) return osrmCache.get(key);

  let waypoints = coords;
  if (waypoints.length > MAX_WAYPOINTS) {
    const step = (coords.length - 1) / (MAX_WAYPOINTS - 1);
    waypoints = [];
    for (let i = 0; i < MAX_WAYPOINTS; i++) {
      waypoints.push(coords[Math.min(Math.round(i * step), coords.length - 1)]);
    }
  }

  const coordsStr = waypoints.map(([lat, lon]) => `${lon},${lat}`).join(';');
  const url = `${OSRM_URL}/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const geom = data?.routes?.[0]?.geometry;
    if (!geom?.coordinates?.length) return null;

    const points = geom.coordinates.map(([lon, lat]) => [lat, lon]);
    osrmCache.set(key, points);
    return points;
  } catch (_) {
    return null;
  }
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

    const recordedCalls = [];
    const rcEls = jel.getElementsByTagNameNS(SIRI_NS, 'RecordedCall');
    for (let r = 0; r < rcEls.length; r++) {
      const cel = rcEls[r];
      const ref = cel.getElementsByTagNameNS(SIRI_NS, 'StopPointRef')[0]?.textContent;
      const dep = parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ActualDepartureTime')[0]?.textContent)
        || parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ActualArrivalTime')[0]?.textContent);
      if (ref && dep) recordedCalls.push({ quayId: ref, time: dep });
    }

    const estimatedCalls = [];
    const ecEls = jel.getElementsByTagNameNS(SIRI_NS, 'EstimatedCall');
    for (let e = 0; e < ecEls.length; e++) {
      const cel = ecEls[e];
      const ref = cel.getElementsByTagNameNS(SIRI_NS, 'StopPointRef')[0]?.textContent;
      const arr = parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ExpectedArrivalTime')[0]?.textContent)
        || parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ExpectedDepartureTime')[0]?.textContent);
      const dep = parseIsoTime(cel.getElementsByTagNameNS(SIRI_NS, 'ExpectedDepartureTime')[0]?.textContent);
      if (ref && (arr || dep)) estimatedCalls.push({ quayId: ref, arrTime: arr || dep, depTime: dep || arr });
    }

    if (recordedCalls.length === 0 && estimatedCalls.length === 0) continue;

    journeys.push({
      mode,
      lineRef,
      recordedCalls,
      estimatedCalls,
    });
  }
  return journeys;
}

function buildRouteShapes(journeys) {
  const seen = new Set();
  const shapes = [];
  const routeModes = new Set(['metro', 'tram', 'water', 'bus']);

  for (const j of journeys) {
    if (!routeModes.has(j.mode)) continue;
    const allCalls = [...j.recordedCalls, ...j.estimatedCalls];
    const points = [];
    for (const c of allCalls) {
      const coords = quayCoordCache.get(c.quayId);
      if (coords) points.push(coords);
    }
    if (points.length < 2) continue;
    const key = points.map((p) => `${p[0].toFixed(4)},${p[1].toFixed(4)}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    shapes.push({ mode: j.mode, points });
  }
  return shapes;
}

async function enrichWithOsrm(shapes, concurrency = 5) {
  const toEnrich = shapes.filter((s) => (s.mode === 'bus' || s.mode === 'tram') && s.points?.length >= 2);

  for (let i = 0; i < toEnrich.length; i += concurrency) {
    const batch = toEnrich.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (shape) => {
        const geometry = await getOsrmGeometry(shape.points);
        return geometry ? { ...shape, points: geometry } : shape;
      })
    );
    for (let j = 0; j < batch.length; j++) {
      const idx = shapes.indexOf(batch[j]);
      if (idx >= 0 && results[j].points !== batch[j].points) shapes[idx] = results[j];
    }
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
  try {
    const xml = await fetchEtXml();
    const journeys = parseSiriXml(xml);

    const uniqueLineRefs = [...new Set(journeys.map((j) => j.lineRef).filter(Boolean))];
    await fetchLineModes(uniqueLineRefs);

    for (const j of journeys) {
      const jpMode = lineModeCache.get(j.lineRef);
      if (jpMode) j.mode = jpMode;
    }

    const quayIds = new Set();
    for (const j of journeys) {
      for (const c of [...j.recordedCalls, ...j.estimatedCalls]) {
        if (c?.quayId) quayIds.add(c.quayId);
      }
    }
    await fetchQuayCoordsBatch([...quayIds]);

    let shapes = buildRouteShapes(journeys);
    shapes = await enrichWithOsrm(shapes);

    cachedShapes = shapes;
    lastFetch = Date.now();
    return shapes;
  } catch (err) {
    console.warn('[RuterLive] shape-service refresh error:', err.message);
    return cachedShapes;
  }
}
