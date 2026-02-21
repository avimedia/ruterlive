/**
 * SIRI ET (Estimated Timetable) – beregnet posisjon for buss, T-bane, trikk og båt.
 * Ruter leverer ikke GPS til Entur, så vi interpolerer mellom stopp basert på avgangsdata.
 */

import { enrichShapesWithOSRM } from './osrm.js';

const ET_URL = '/api/entur-et/et?datasetId=RUT&maxSize=3000';
const GEOCODER_URL = '/api/entur-geocoder/autocomplete';
const JP_GRAPHQL_URL = '/api/entur-jp/graphql';
const CLIENT_NAME = 'ruterlive-web';

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

// Oslo sentrum – brukes for å prioritere Geocoder-treff
const OSLO_FOCUS = { lat: 59.91, lon: 10.75 };
const MAX_QUAYS_TO_FETCH = 500; // Flere holdeplasser = flere busser med beregnet posisjon

const JP_BATCH_SIZE = 25; // Større batch = færre requests

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

async function getQuayCoords(quayId, stopName) {
  if (quayCoordCache.has(quayId)) {
    return quayCoordCache.get(quayId);
  }
  // Fallback: Geocoder søk på holdeplassnavn
  const OSLO_BBOX = { minLat: 59.5, maxLat: 60.3, minLon: 10.1, maxLon: 11.3 };
  const searchConfigs = [
    { text: stopName.includes('Oslo') ? stopName : `${stopName} Oslo`, tariffZone: true },
    { text: stopName, tariffZone: true },
    { text: stopName.includes('Oslo') ? stopName : `${stopName} Oslo`, tariffZone: false },
    { text: stopName, tariffZone: false },
  ];
  for (const { text: searchText, tariffZone } of searchConfigs) {
    if (!searchText?.trim()) continue;
    try {
      const params = new URLSearchParams({
        text: searchText,
        size: '5',
        'boundary.country': 'NOR',
        layers: 'venue',
        'focus.point.lat': String(OSLO_FOCUS.lat),
        'focus.point.lon': String(OSLO_FOCUS.lon),
      });
      if (tariffZone) params.set('tariff_zone_authorities', 'RUT');
      const url = `${GEOCODER_URL}?${params}`;
      const res = await fetch(url, { headers: { 'ET-Client-Name': CLIENT_NAME } });
      const data = await res.json();
      const features = data?.features || [];
      for (const feat of features) {
        const coords = feat?.geometry?.coordinates;
        if (coords) {
          const [lon, lat] = coords;
          if (lat >= OSLO_BBOX.minLat && lat <= OSLO_BBOX.maxLat && lon >= OSLO_BBOX.minLon && lon <= OSLO_BBOX.maxLon) {
            quayCoordCache.set(quayId, [lat, lon]);
            return [lat, lon];
          }
        }
      }
      if (features[0]?.geometry?.coordinates) {
        const [lon, lat] = features[0].geometry.coordinates;
        if (lat >= OSLO_BBOX.minLat && lat <= OSLO_BBOX.maxLat && lon >= OSLO_BBOX.minLon && lon <= OSLO_BBOX.maxLon) {
          quayCoordCache.set(quayId, [lat, lon]);
          return [lat, lon];
        }
      }
    } catch (_) {}
  }
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
    await Promise.all(batch.map(({ quayId, name }) => getQuayCoords(quayId, name)));
  }
}

export async function fetchEstimatedVehicles(onProgress) {
  try {
    const res = await fetch(ET_URL, { headers: { 'ET-Client-Name': CLIENT_NAME } });
    if (!res.ok) throw new Error(`ET API ${res.status}`);
    const xml = await res.text();
    const journeys = parseSiriXml(xml);

    const uniqueLineRefs = [...new Set(journeys.map((j) => j.lineRef).filter(Boolean))];
    await fetchLineModesBatch(uniqueLineRefs);

    for (const j of journeys) {
      const jpMode = lineModeCache.get(j.lineRef);
      if (jpMode) j.mode = jpMode;
    }

    const quaysToFetch = new Map();
    for (const j of journeys) {
      for (const c of [...j.recordedCalls, ...j.estimatedCalls]) {
        if (c?.quayId) quaysToFetch.set(c.quayId, c.name);
      }
    }
    const quayList = [...quaysToFetch.entries()]
      .map(([quayId, name]) => ({ quayId, name }))
      .slice(0, MAX_QUAYS_TO_FETCH);
    await fetchQuayCoordsBatch(quayList);

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

      const fromCoords = fromCall ? quayCoordCache.get(fromCall.quayId) ?? await getQuayCoords(fromCall.quayId, fromCall.name) : null;
      const toCoords = toCall ? quayCoordCache.get(toCall.quayId) ?? await getQuayCoords(toCall.quayId, toCall.name) : null;

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
        vehicles.push({
          vehicleId: j.vehicleId,
          mode: j.mode,
          location: { latitude: lat, longitude: lon },
          line: { publicCode: getLinePublicCode(j.lineRef) },
          destinationName: j.destinationName,
          bearing: null,
        });
      }
    }

    let routeShapes = buildRouteShapes(journeys);
    try {
      routeShapes = await enrichShapesWithOSRM(routeShapes);
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[RuterLive] OSRM berikelse feilet, bruker rette linjer:', err);
    }

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
      points,
    });
  }
  if (import.meta.env.DEV && shapes.length > 0) {
    console.debug('[RuterLive] routeShapes:', shapes.length, 'avg points:', (shapes.reduce((s, sh) => s + sh.points.length, 0) / shapes.length).toFixed(0));
  }
  return shapes;
}
