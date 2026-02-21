/**
 * Henter flybuss- og togruter fra Journey Planner. Kjøres daglig sammen med ET-rutene.
 */

import { fetchWithRetry } from './fetch-with-retry.js';

const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const CLIENT_NAME = 'ruterlive-web';
const JP_QUAY_BATCH = 25;

async function fetchQuayCoords(quayIds, quayCoordCache) {
  const ids = quayIds.filter((id) => /^NSR:Quay:\d+$/.test(id));
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

async function fetchTripShapes(trips, modes) {
  const allShapes = [];
  const modesArg = modes.map((m) => `{ transportMode: ${m} }`).join(', ');

  for (const trip of trips) {
    const { from, fromName, to, toName } = trip;
    try {
      const data = await fetchJp({
        query: `{ trip(from: { place: "${from}", name: "${fromName}" }, to: { place: "${to}", name: "${toName}" }, numTripPatterns: 5, modes: { transportModes: [${modesArg}] }) {
          tripPatterns {
            legs {
              mode
              line { publicCode }
              fromPlace { name }
              toPlace { name }
              fromEstimatedCall { quay { id name } }
              toEstimatedCall { quay { id name } }
              intermediateEstimatedCalls { quay { id name } }
            }
          }
        } }`,
      });

      const patterns = data?.trip?.tripPatterns || [];
      for (const p of patterns) {
        for (const leg of p.legs || []) {
          const lineCode = leg?.line?.publicCode || '';
          if (!lineCode) continue;
          if (!modes.includes('rail') && !/^FB\d*$/i.test(lineCode)) continue;

          const quayIds = [];
          const fromQ = leg.fromEstimatedCall?.quay;
          const toQ = leg.toEstimatedCall?.quay;
          if (fromQ?.id) quayIds.push({ id: fromQ.id, name: fromQ?.name });
          for (const c of leg.intermediateEstimatedCalls || []) {
            if (c?.quay?.id && c.quay.id !== fromQ?.id) quayIds.push({ id: c.quay.id, name: c.quay?.name });
          }
          if (toQ?.id && toQ.id !== fromQ?.id) quayIds.push({ id: toQ.id, name: toQ?.name });

          if (quayIds.length < 2) continue;

          const isFlytog = /^F\d*$|^FX$/.test(lineCode);
          allShapes.push({
            mode: modes.includes('rail') ? (isFlytog ? 'flytog' : 'rail') : 'flybuss',
            line: lineCode,
            from: quayIds[0]?.name || leg.fromPlace?.name || '',
            to: quayIds[quayIds.length - 1]?.name || leg.toPlace?.name || '',
            via: quayIds.length > 2 ? quayIds[Math.floor(quayIds.length / 2)]?.name : null,
            quayIds: quayIds.map((q) => q.id),
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
  const railShapes = await fetchTripShapes(RAIL_TRIPS, ['rail']);
  const flybussShapes = await fetchTripShapes(FLYBUSS_TRIPS, ['bus', 'coach']);

  const allProto = [...railShapes, ...flybussShapes];
  const allQuayIds = [...new Set(allProto.flatMap((s) => s.quayIds).filter(Boolean))];
  await fetchQuayCoords(allQuayIds, quayCoordCache);

  const shapes = [];
  const seen = new Set();

  for (const s of allProto) {
    const points = [];
    for (const qid of s.quayIds) {
      const coords = quayCoordCache.get(qid);
      if (coords) points.push(coords);
    }
    if (points.length < 2) continue;

    const firstQuayId = s.quayIds[0];
    if (s.quayIds.length > 1 && s.quayIds[s.quayIds.length - 1] === firstQuayId) {
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
