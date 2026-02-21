/**
 * Henter flybuss- og togruter fra Journey Planner. Bruker pointsOnLink for faktisk trasé.
 */

import { fetchWithRetry } from './fetch-with-retry.js';
import { ensureGtfsStopsLoaded, getGtfsQuayCache } from './gtfs-stops-loader.js';

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

// Bruk NSR StopPlace-IDs for pålitelige søk (fra Entur-dokumentasjonen)
const RAIL_TRIPS = [
  // Drammensbanen / Vestfoldbanen
  { from: 'NSR:StopPlace:11', fromName: 'Drammen stasjon', to: 'NSR:StopPlace:288', toName: 'Nationaltheatret' },
  { from: 'NSR:StopPlace:288', fromName: 'Nationaltheatret', to: 'NSR:StopPlace:11', toName: 'Drammen stasjon' },
  // Østfoldbanen øst
  { from: 'NSR:StopPlace:6234', fromName: 'Lillestrøm', to: 'NSR:StopPlace:288', toName: 'Nationaltheatret' },
  { from: 'NSR:StopPlace:288', fromName: 'Nationaltheatret', to: 'NSR:StopPlace:6234', toName: 'Lillestrøm' },
  { from: 'NSR:StopPlace:6010', fromName: 'Ski', to: 'NSR:StopPlace:288', toName: 'Nationaltheatret' },
  { from: 'NSR:StopPlace:288', fromName: 'Nationaltheatret', to: 'NSR:StopPlace:6010', toName: 'Ski' },
  // Flytoget
  { from: 'NSR:StopPlace:269', fromName: 'Oslo lufthavn', to: 'NSR:StopPlace:288', toName: 'Nationaltheatret' },
  { from: 'NSR:StopPlace:288', fromName: 'Nationaltheatret', to: 'NSR:StopPlace:269', toName: 'Oslo lufthavn' },
  // Oslo S – flere strekninger (Østfoldbanen, Drammen)
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:6234', toName: 'Lillestrøm' },
  { from: 'NSR:StopPlace:6234', fromName: 'Lillestrøm', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:6010', toName: 'Ski' },
  { from: 'NSR:StopPlace:6010', fromName: 'Ski', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:11', toName: 'Drammen stasjon' },
  { from: 'NSR:StopPlace:11', fromName: 'Drammen stasjon', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
];

const FLYBUSS_TRIPS = [
  { from: 'NSR:StopPlace:6505', fromName: 'Oslo Bussterminal', to: 'NSR:StopPlace:269', toName: 'Oslo lufthavn' },
  { from: 'NSR:StopPlace:269', fromName: 'Oslo lufthavn', to: 'NSR:StopPlace:6505', toName: 'Oslo Bussterminal' },
  { from: 'NSR:StopPlace:59872', fromName: 'Oslo S', to: 'NSR:StopPlace:269', toName: 'Oslo lufthavn' },
  { from: 'NSR:StopPlace:269', fromName: 'Oslo lufthavn', to: 'NSR:StopPlace:59872', toName: 'Oslo S' },
];

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

async function fetchTripShapes(trips, modes, acceptAllBus = false) {
  const allShapes = [];
  const modesArg = modes.map((m) => `{ transportMode: ${m} }`).join(', ');

  const dateTime = new Date().toISOString().slice(0, 19);
  for (const trip of trips) {
    const { from, fromName, to, toName } = trip;
    try {
      const data = await fetchJp({
        query: `{ trip(from: { place: "${from}", name: "${fromName}" }, to: { place: "${to}", name: "${toName}" }, dateTime: "${dateTime}", numTripPatterns: 10, modes: { transportModes: [${modesArg}] }) {
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
      for (const p of patterns) {
        for (const leg of p.legs || []) {
          const lineCode = leg?.line?.publicCode || '';
          if (!lineCode) continue;
          if (!modes.includes('rail') && !acceptAllBus && !/^(FB|NW)\d*$/i.test(lineCode)) continue;

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
          allShapes.push({
            mode,
            line: lineCode,
            from: (quayIds[0]?.name || leg.fromPlace?.name || '').trim(),
            to: (quayIds[quayIds.length - 1]?.name || leg.toPlace?.name || '').trim(),
            via: quayIds.length > 2 ? quayIds[Math.floor(quayIds.length / 2)]?.name : null,
            quayIds: quayIds.map((q) => q.id).filter(Boolean),
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
  await ensureGtfsStopsLoaded();
  const railShapes = await fetchTripShapes(RAIL_TRIPS, ['rail']);
  const flybussShapes = await fetchTripShapes(FLYBUSS_TRIPS, ['bus', 'coach'], true);

  const railCount = railShapes.filter((s) => s.mode === 'flytog').length;
  const flybussCount = flybussShapes.length;
  console.log(`[RuterLive] JP routes: ${railShapes.length} rail (${railCount} flytog), ${flybussCount} flybuss`);

  const allProto = [...railShapes, ...flybussShapes];
  const allQuayIds = [...new Set(allProto.flatMap((s) => s.quayIds).filter(Boolean))];
  await fetchQuayCoords(allQuayIds, quayCoordCache);

  const shapes = [];
  const seen = new Set();

  for (const s of allProto) {
    let points = [];
    if (s.pointsOnLinkEncoded) {
      points = decodePolyline(s.pointsOnLinkEncoded);
    }
    if (points.length < 2) {
      for (const qid of s.quayIds) {
        const coords = quayCoordCache.get(qid);
        if (coords) points.push(coords);
      }
    }
    if (points.length < 2) continue;

    const firstQuayId = s.quayIds?.[0];
    if (s.quayIds?.length > 1 && s.quayIds[s.quayIds.length - 1] === firstQuayId) {
      points.pop();
    }

    const key = `${s.line}|${points[0][0].toFixed(4)},${points[0][1].toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { quayIds, ...rest } = s;
    shapes.push({ ...rest, points });
  }
  return shapes;
}
