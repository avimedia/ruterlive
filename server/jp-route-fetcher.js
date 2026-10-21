/**
 * Henter flybuss- og togruter fra Journey Planner. Bruker pointsOnLink for faktisk trasé.
 */

import { fetchWithRetry } from './fetch-with-retry.js';
import { getGtfsQuayCache } from './gtfs-stops-loader.js';

const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const CLIENT_NAME = 'ruterlive-web';
const JP_QUAY_BATCH = 25;

/** Dekoder Google polyline (pointsOnLink.points) til [[lat, lon], ...] */
function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return [];
  const values = [];
  let current = 0;
  let bits = 0;
  for (let i = 0; i < encoded.length; i++) {
    const byte = encoded.charCodeAt(i) - 63;
    current |= (byte & 0x1f) << bits;
    bits += 5;
    if (byte < 0x20) {
      values.push(byte & 1 ? ~(current >>> 1) : current >>> 1);
      current = 0;
      bits = 0;
    }
  }
  const points = [];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < values.length; i += 2) {
    lat += values[i] / 1e5;
    lon += values[i + 1] / 1e5;
    points.push([lat, lon]);
  }
  return points;
}

async function fetchQuayCoords(quayIds, quayCoordCache) {
  const gtfs = getGtfsQuayCache();
  for (const id of quayIds) {
    if (gtfs?.has(id) && !quayCoordCache.has(id)) {
      quayCoordCache.set(id, gtfs.get(id));
    }
  }
  const ids = quayIds.filter((id) => /^NSR:Quay:\d+$/.test(id) && !quayCoordCache.has(id));
  for (let i = 0; i < ids.length; i += JP_QUAY_BATCH) {
    const batch = ids.slice(i, i + JP_QUAY_BATCH);
    const lines = batch.map((id, j) => `q${j}: quay(id: "${id}") { latitude longitude }`).join('\n');
    const data = await fetchJp({ query: `query { ${lines} }` });
    if (!data) continue;
    batch.forEach((id, j) => {
      const q = data[`q${j}`];
      if (q?.latitude != null && q?.longitude != null) {
        quayCoordCache.set(id, [q.latitude, q.longitude]);
      }
    });
  }
}

/** Hub-stasjoner for dynamisk oppdaging av tog- og flybussruter via avgangstavler. */
const ROUTE_HUBS = [
  { id: 'NSR:StopPlace:59872', name: 'Oslo S', modes: ['rail'] },
  { id: 'NSR:StopPlace:269', name: 'Oslo lufthavn', modes: ['rail', 'bus', 'coach'] },
  { id: 'NSR:StopPlace:6505', name: 'Oslo Bussterminal', modes: ['bus', 'coach'] },
];

/** Fallback når avgangstavle-API returnerer tomt (f.eks. timeout, schema-endring). */
const FALLBACK_RAIL_TRIPS = [
  { from: 'NSR:StopPlace:12497', fromName: 'Skien', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:12497', toName: 'Skien' },
  { from: 'NSR:StopPlace:11', fromName: 'Drammen stasjon', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:11', toName: 'Drammen stasjon' },
  { from: 'NSR:StopPlace:6234', fromName: 'Lillestrøm', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:6234', toName: 'Lillestrøm' },
  { from: 'NSR:StopPlace:6010', fromName: 'Ski', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:6010', toName: 'Ski' },
  { from: 'NSR:StopPlace:236', fromName: 'Eidsvoll', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:236', toName: 'Eidsvoll' },
  { from: 'NSR:StopPlace:222', fromName: 'Kongsberg', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:222', toName: 'Kongsberg' },
  { from: 'NSR:StopPlace:269', fromName: 'Oslo lufthavn', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:269', toName: 'Oslo lufthavn' },
];

/**
 * Henter unike (linje, destinasjon)-par fra avgangstavler.
 * @returns {{ rail: Array<{from,fromName,to,toName}>, flybuss: Array<{from,fromName,to,toName}> }}
 */
async function discoverTripsFromDepartureBoards() {
  const timeRange = 86400; // 24t
  const numberOfDepartures = 60;
  const railPairs = new Map(); // "fromName|toName" -> trip
  const flybussPairs = new Map();

  for (const hub of ROUTE_HUBS) {
    try {
      const data = await fetchJp({
        query: `query {
          stopPlace(id: "${hub.id}") {
            name
            estimatedCalls(timeRange: ${timeRange}, numberOfDepartures: ${numberOfDepartures}) {
              destinationDisplay { frontText }
              serviceJourney {
                journeyPattern {
                  line { publicCode transportMode }
                }
              }
            }
            quays {
              estimatedCalls(timeRange: ${timeRange}, numberOfDepartures: 20) {
                destinationDisplay { frontText }
                serviceJourney {
                  journeyPattern {
                    line { publicCode transportMode }
                  }
                }
              }
            }
          }
        }`,
      });
      let calls = data?.stopPlace?.estimatedCalls || [];
      if (calls.length === 0 && data?.stopPlace?.quays?.length) {
        calls = data.stopPlace.quays.flatMap((q) => q.estimatedCalls || []);
      }
      for (const c of calls) {
        const line = c?.serviceJourney?.journeyPattern?.line;
        const mode = (line?.transportMode || '').toLowerCase();
        const dest = (c?.destinationDisplay?.frontText || '').trim();
        if (!line?.publicCode || !dest) continue;
        const lineCode = line.publicCode;

        if (hub.modes.includes('rail') && mode === 'rail') {
          const key = `${hub.name}|${dest}`;
          if (!railPairs.has(key)) {
            railPairs.set(key, {
              from: hub.id,
              fromName: hub.name,
              to: dest,
              toName: dest,
            });
          }
        }
        if ((hub.modes.includes('bus') || hub.modes.includes('coach')) && /^(FB|NW)\d*$/i.test(lineCode)) {
          const toLufthavn = /lufthavn|gardermoen|osl/i.test(dest);
          const key = `${hub.name}|${toLufthavn ? 'Oslo lufthavn' : dest}`;
          if (!flybussPairs.has(key)) {
            flybussPairs.set(key, {
              from: hub.id,
              fromName: hub.name,
              to: toLufthavn ? 'NSR:StopPlace:269' : undefined,
              toName: toLufthavn ? 'Oslo lufthavn' : dest,
            });
          }
        }
      }
    } catch (err) {
      console.warn('[RuterLive] Departure board fetch', hub.name, err.message);
    }
  }

  const railTrips = [];
  const seenRail = new Set();
  for (const trip of railPairs.values()) {
    const fwd = `${trip.fromName}|${trip.toName}`;
    if (seenRail.has(fwd)) continue;
    seenRail.add(fwd);
    railTrips.push(trip);
    const rev = `${trip.toName}|${trip.fromName}`;
    if (!seenRail.has(rev)) {
      seenRail.add(rev);
      railTrips.push({ from: undefined, fromName: trip.toName, to: trip.from, toName: trip.fromName });
    }
  }

  const flybussTrips = [];
  const seenFb = new Set();
  for (const trip of flybussPairs.values()) {
    const fwd = `${trip.fromName}|${trip.toName}`;
    if (seenFb.has(fwd)) continue;
    seenFb.add(fwd);
    flybussTrips.push(trip);
    if (trip.toName === 'Oslo lufthavn' && trip.fromName !== 'Oslo lufthavn') {
      const rev = `Oslo lufthavn|${trip.fromName}`;
      if (!seenFb.has(rev)) {
        seenFb.add(rev);
        flybussTrips.push({
          from: 'NSR:StopPlace:269',
          fromName: 'Oslo lufthavn',
          to: trip.from,
          toName: trip.fromName,
        });
      }
    }
  }

  return { rail: railTrips, flybuss: flybussTrips };
}

async function fetchJp(body) {
  const res = await fetchWithRetry(
    JP_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
      body: JSON.stringify(body),
    },
    { timeout: 25000 }
  );
  const data = await res.json();
  return data?.data;
}

function buildPlaceArg(placeId, name) {
  const n = (name || '').replace(/"/g, '\\"');
  if (placeId) return `{ place: "${placeId}", name: "${n}" }`;
  return `{ name: "${n}" }`;
}

async function fetchTripShapes(trips, modes, acceptAllBus = false) {
  const allShapes = [];
  const dateTime = new Date().toISOString().slice(0, 19);
  const useModes = modes.length > 0 && !modes.includes('rail');
  const modesStr = useModes ? `, modes: { transportModes: [${modes.map((m) => `{ transportMode: ${m} }`).join(', ')}] }` : '';

  for (const trip of trips) {
    const { from, fromName, to, toName } = trip;
    const fromArg = buildPlaceArg(from, fromName);
    const toArg = buildPlaceArg(to, toName);
    try {
      const data = await fetchJp({
        query: `{ trip(from: ${fromArg}, to: ${toArg}, dateTime: "${dateTime}", numTripPatterns: 10${modesStr}) {
          tripPatterns {
            legs {
              mode
              line { publicCode }
              fromPlace { name }
              toPlace { name }
              fromEstimatedCall { quay { id name } }
              toEstimatedCall { quay { id name } }
              intermediateEstimatedCalls { quay { id name } }
              pointsOnLink { points }
            }
          }
        } }`,
      });

      const patterns = data?.trip?.tripPatterns || [];
      const useTripEndpoints = modes.includes('rail');
      const wantRail = modes.includes('rail');
      for (const p of patterns) {
        for (const leg of p.legs || []) {
          const lineCode = leg?.line?.publicCode || '';
          if (!lineCode) continue;
          const legMode = (leg.mode || '').toLowerCase();
          if (wantRail && legMode !== 'rail') continue;
          if (!wantRail && !acceptAllBus && !/^(FB|NW)\d*$/i.test(lineCode)) continue;

          const quayIds = [];
          const fromQ = leg.fromEstimatedCall?.quay;
          const toQ = leg.toEstimatedCall?.quay;
          if (fromQ?.id) quayIds.push({ id: fromQ.id, name: fromQ?.name });
          for (const c of leg.intermediateEstimatedCalls || []) {
            if (c?.quay?.id && c.quay.id !== fromQ?.id) quayIds.push({ id: c.quay.id, name: c.quay?.name });
          }
          if (toQ?.id && toQ.id !== fromQ?.id) quayIds.push({ id: toQ.id, name: toQ?.name });

          const pointsOnLinkEncoded = leg.pointsOnLink?.points;
          if (quayIds.length < 2 && !pointsOnLinkEncoded) continue;

          const isFlytog = /^F\d*$|^FX$/.test(lineCode);
          const mode = modes.includes('rail') ? (isFlytog ? 'flytog' : 'rail') : 'flybuss';
          // For tog: bruk hele ruten (trip.fromName/toName), ikke leg-delstrekning
          const fromName = useTripEndpoints ? trip.fromName : (quayIds[0]?.name || leg.fromPlace?.name || '');
          const toName = useTripEndpoints ? trip.toName : (quayIds[quayIds.length - 1]?.name || leg.toPlace?.name || '');
          const midIdx = Math.floor(quayIds.length / 2);
          const via = quayIds.length > 2 ? quayIds[midIdx]?.name : null;
          allShapes.push({
            mode,
            line: lineCode,
            from: (fromName || '').trim(),
            to: (toName || '').trim(),
            via,
            quayIds,
            pointsOnLinkEncoded,
          });
        }
      }
    } catch (err) {
      console.warn('[RuterLive] JP trip fetch:', from, '→', to, err.message);
    }
  }
  return allShapes;
}

/**
 * Henter JP-ruter (tog, flybuss) og konverterer quay-IDs til koordinater.
 * @param {Map} quayCoordCache - cache for quayId -> [lat, lon]
 */
export async function fetchJpRoutes(quayCoordCache) {
  const { flybuss: flybussTrips } = await discoverTripsFromDepartureBoards();
  const railShapes = await fetchTripShapes(FALLBACK_RAIL_TRIPS, ['rail']);
  const flybussShapes = flybussTrips.length > 0 ? await fetchTripShapes(flybussTrips, ['bus', 'coach'], true) : [];

  const railCount = railShapes.filter((s) => s.mode === 'flytog').length;
  const flybussCount = flybussShapes.length;
  console.log(`[RuterLive] JP routes: ${railShapes.length} rail (${railCount} flytog), ${flybussCount} flybuss`);

  const allProto = [...railShapes, ...flybussShapes];
  const allQuayIds = [...new Set(allProto.flatMap((s) => s.quayIds?.map((q) => q?.id).filter(Boolean) ?? []))];
  await fetchQuayCoords(allQuayIds, quayCoordCache);

  const shapes = [];
  const seen = new Set();

  for (const s of allProto) {
    let points = [];
    if (s.pointsOnLinkEncoded) {
      points = decodePolyline(s.pointsOnLinkEncoded);
    }
    if (points.length < 2) {
      for (const q of s.quayIds || []) {
        const id = typeof q === 'object' ? q?.id : q;
        const coords = id ? quayCoordCache.get(id) : null;
        if (coords) points.push(coords);
      }
    }
    if (points.length < 2) continue;

    const firstQ = s.quayIds?.[0];
    const firstQuayId = firstQ?.id ?? firstQ;
    const lastQ = s.quayIds?.[s.quayIds.length - 1];
    const lastQuayId = lastQ?.id ?? lastQ;
    if (s.quayIds?.length > 1 && lastQuayId === firstQuayId) {
      points.pop();
    }

    const key = `${s.line}|${points[0][0].toFixed(4)},${points[0][1].toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { quayIds = [], ...rest } = s;
    const quayStops = quayIds
      .map((q) => {
        const id = typeof q === 'string' ? q : q?.id;
        const name = typeof q === 'object' ? q?.name : '';
        const c = id ? quayCoordCache.get(id) : null;
        return c ? [c[0], c[1], id, name || ''] : null;
      })
      .filter(Boolean);
    shapes.push({ ...rest, points, quayStops });
  }
  return shapes;
}

/** Henter kun flybussruter fra Journey Planner. Brukes for ukentlig automatisk oppdatering. */
export async function fetchFlybussShapesOnly() {
  const { flybuss: flybussTrips } = await discoverTripsFromDepartureBoards();
  if (flybussTrips.length === 0) return [];
  const quayCoordCache = new Map();
  const flybussShapes = await fetchTripShapes(flybussTrips, ['bus', 'coach'], true);
  const allQuayIds = [...new Set(flybussShapes.flatMap((s) => s.quayIds?.map((q) => (typeof q === 'object' ? q?.id : q)).filter(Boolean) ?? []))];
  await fetchQuayCoords(allQuayIds, quayCoordCache);

  const shapes = [];
  const seen = new Set();
  for (const s of flybussShapes) {
    let points = [];
    if (s.pointsOnLinkEncoded) points = decodePolyline(s.pointsOnLinkEncoded);
    if (points.length < 2) {
      for (const q of s.quayIds || []) {
        const id = typeof q === 'object' ? q?.id : q;
        const coords = id ? quayCoordCache.get(id) : null;
        if (coords) points.push(coords);
      }
    }
    if (points.length < 2) continue;
    const firstQ = s.quayIds?.[0];
    const lastQ = s.quayIds?.[s.quayIds.length - 1];
    const firstQuayId = firstQ?.id ?? firstQ;
    const lastQuayId = lastQ?.id ?? lastQ;
    if (s.quayIds?.length > 1 && lastQuayId === firstQuayId) points.pop();
    const key = `${s.line}|${points[0][0].toFixed(4)},${points[0][1].toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { quayIds = [], ...rest } = s;
    const quayStops = (quayIds || [])
      .map((q) => {
        const id = typeof q === 'object' ? q?.id : q;
        const name = typeof q === 'object' ? q?.name : '';
        const c = id ? quayCoordCache.get(id) : null;
        return c ? [c[0], c[1], id, name || ''] : null;
      })
      .filter(Boolean);
    shapes.push({ ...rest, points, quayStops });
  }
  return shapes;
}

/** Henter kun jernbaneruter (regiontog, flytoget). Bruker NSR StopPlace-IDer – avgangstavle-navn gir 0 resultater i trip-søk. */
export async function fetchRailShapesOnly() {
  const quayCoordCache = new Map();
  const railShapes = await fetchTripShapes(FALLBACK_RAIL_TRIPS, ['rail']);
  const allQuayIds = [...new Set(railShapes.flatMap((s) => s.quayIds?.map((q) => (typeof q === 'object' ? q?.id : q)).filter(Boolean) ?? []))];
  await fetchQuayCoords(allQuayIds, quayCoordCache);
  const shapes = [];
  const seen = new Set();
  for (const s of railShapes) {
    let points = [];
    if (s.pointsOnLinkEncoded) points = decodePolyline(s.pointsOnLinkEncoded);
    if (points.length < 2) {
      for (const q of s.quayIds || []) {
        const id = typeof q === 'object' ? q?.id : q;
        const coords = id ? quayCoordCache.get(id) : null;
        if (coords) points.push(coords);
      }
    }
    if (points.length < 2) continue;
    const firstQ = s.quayIds?.[0];
    const lastQ = s.quayIds?.[s.quayIds.length - 1];
    const firstQuayId = firstQ?.id ?? firstQ;
    const lastQuayId = lastQ?.id ?? lastQ;
    if (s.quayIds?.length > 1 && lastQuayId === firstQuayId) points.pop();
    const key = `${s.line}|${points[0][0].toFixed(4)},${points[0][1].toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const { quayIds = [], ...rest } = s;
    const quayStops = quayIds
      .map((q) => {
        const id = typeof q === 'object' ? q?.id : q;
        const name = typeof q === 'object' ? q?.name : '';
        const c = id ? quayCoordCache.get(id) : null;
        return c ? [c[0], c[1], id, name || ''] : null;
      })
      .filter(Boolean);
    shapes.push({ ...rest, points, quayStops });
  }
  return shapes;
}
