/**
 * Tog uten GPS (SJ Norge, SJ, Tågkompaniet): posisjon interpolert fra SIRI ET, datasett BNR (Bane NOR).
 * BNR er lite (~1,5 MB XML, ~100 turer), men hentes sjelden: hvert 4. min, 10 min pause etter 429,
 * hard tidsgrense for hele nedlastingen. XML-en parses mens den strømmer inn (et-parse.js);
 * bare de parsede turene beholdes.
 *
 * Quay-koordinater: GTFS-cachen dekker bare Oslo-området, så resten slås opp i Journey Planner
 * (quay(id), 25 per kall) og huskes i 24 t. Togstasjoner i hele landet er noen hundre.
 *
 * Turer med samme tognummer og dato som et GPS-tog (Vy: vehicleId «320-2026-10-26») hoppes over.
 */

import { createEtStreamParser } from './et-parse.js';
import { buildVehiclePath, positionAt } from '../shared/vehicle-path.js';
import { CLIENT_NAME } from './entur-client.js';
import { getGtfsQuayCache } from './gtfs-stops-loader.js';

const ET_URL = 'https://api.entur.io/realtime/v1/rest/et?datasetId=BNR&maxSize=2000';
const JP_URL = 'https://api.entur.io/journey-planner/v3/graphql';
const REFRESH_MS = 4 * 60 * 1000;
const BACKOFF_AFTER_429_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 45000;
const COMPUTE_TTL_MS = 15000;
const QUAY_TTL_MS = 24 * 60 * 60 * 1000;
const QUAY_MISS_TTL_MS = 60 * 60 * 1000;
const QUAY_BATCH = 25;
/** Tog vises fra litt før avgang (står på perrongen) til ankomst. */
const SHOW_BEFORE_DEPARTURE_MS = 10 * 60 * 1000;
const SHOW_AFTER_ARRIVAL_MS = 60 * 1000;
const NO_VEHICLES = Object.freeze([]);
/** Lange strekninger mellom stasjoner (Nordlandsbanen, Bergensbanen). */
const MAX_HOP_KM = 250;

/** Tognummer + dato: «1793:2026-10-26» (BNR) og «1793-2026-10-26» (Vy GPS) gir samme nøkkel. */
export function trainKey(id) {
  const m = /(?:^|[^\d])(\d{1,6})[:-](\d{4}-\d{2}-\d{2})$/.exec(String(id ?? ''));
  return m ? `${m[1]}|${m[2]}` : null;
}

/** Linjekode fra lineRef («SJN:Line:R70» → R70); «-» og tomme gir null. */
export function railLineCode(lineRef) {
  const code = String(lineRef ?? '').split(':').pop();
  return /^[A-Za-z0-9]{1,10}$/.test(code) ? code : null;
}

const callTime = (c) => c?.depTime ?? c?.arrTime ?? c?.time ?? null;
const firstTime = (j) => (j.recordedCalls.length ? j.recordedCalls[0].time : callTime(j.estimatedCalls[0]));
function lastTime(j) {
  const e = j.estimatedCalls[j.estimatedCalls.length - 1];
  if (e) return e.arrTime ?? e.depTime;
  return j.recordedCalls[j.recordedCalls.length - 1]?.time ?? null;
}

/**
 * Turer som er i gang nå (eller går om under 10 min), ikke er fremme, og ikke har GPS.
 * @param {object[]} journeys parsede ET-turer
 * @param {number} now ms
 * @param {Set<string>} gpsKeys trainKey for GPS-togene
 */
export function selectRailJourneys(journeys, now, gpsKeys = new Set()) {
  const out = [];
  const seen = new Set();
  for (const j of journeys ?? []) {
    if (!j?.estimatedCalls?.length) continue; // fremme eller bare passerte kall
    const start = firstTime(j);
    const end = lastTime(j);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start - SHOW_BEFORE_DEPARTURE_MS > now || end + SHOW_AFTER_ARRIVAL_MS < now) continue;
    const key = trainKey(j.datedVehicleJourneyRef);
    if (key && gpsKeys.has(key)) continue;
    const id = `BNR:${j.datedVehicleJourneyRef || j.vehicleId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(j);
  }
  return out;
}

/** Ett ET-tog → kjøretøy i samme format som RUT ET (path i ms), eller null uten koordinater. */
export function railJourneyToVehicle(j, getCoords, now) {
  const path = buildVehiclePath(j.recordedCalls, j.estimatedCalls, getCoords, { maxHopKm: MAX_HOP_KM });
  let pos = path ? positionAt(path, now) : null;
  if (!pos) {
    const c = [...j.recordedCalls].reverse().concat(j.estimatedCalls).map((x) => getCoords(x.quayId)).find(Boolean);
    if (!c) return null;
    pos = c;
  }
  const calls = [...j.recordedCalls, ...j.estimatedCalls];
  const first = calls[0];
  const last = calls[calls.length - 1];
  const next = j.estimatedCalls.find((c) => (c.arrTime ?? c.depTime) > now) ?? j.estimatedCalls[0];
  const dest = j.destinationName || last?.name || null;
  const code = railLineCode(j.lineRef);
  return {
    vehicleId: `BNR:${j.datedVehicleJourneyRef || j.vehicleId}`,
    mode: 'rail', // alltid tog: linjenummer-fallbacken (≥ 20 → buss) skal aldri brukes her
    location: { latitude: pos[0], longitude: pos[1] },
    line: { publicCode: code, lineRef: j.lineRef || null },
    destinationName: dest,
    bearing: null,
    from: first?.name || null,
    to: dest,
    nextStop: next?.name && next.name !== dest ? next.name : null,
    via: calls.length > 2 ? calls[Math.floor(calls.length / 2)]?.name : null,
    ...(path ? { path } : {}),
    ...(next?.delay > 0 ? { delay: next.delay } : {}),
  };
}

/**
 * Quay-koordinater for hele landet: GTFS-cachen (Oslo) først, ellers JP quay(id), cachet 24 t.
 * @param {{ jpFetch: (query: string) => Promise<object|null>, now?: () => number, gtfs?: () => Map|null }} deps
 */
export function createQuayCoords({ jpFetch, now = () => Date.now(), gtfs = getGtfsQuayCache }) {
  const cache = new Map(); // id -> { at, ttl, xy: [lat, lon] | null }
  const get = (id) => {
    const g = gtfs?.();
    if (g?.has(id)) return g.get(id);
    return cache.get(id)?.xy ?? undefined;
  };
  async function ensure(ids) {
    const g = gtfs?.();
    const missing = [];
    for (const id of new Set(ids)) {
      if (!/^NSR:Quay:\d+$/.test(id) || g?.has(id)) continue;
      const c = cache.get(id);
      if (c && now() - c.at < c.ttl) continue;
      missing.push(id);
    }
    for (let i = 0; i < missing.length; i += QUAY_BATCH) {
      const batch = missing.slice(i, i + QUAY_BATCH);
      const query = `query { ${batch.map((id, k) => `q${k}: quay(id: "${id}") { latitude longitude }`).join(' ')} }`;
      const data = await jpFetch(query);
      if (!data) continue; // feil: prøv igjen neste runde
      batch.forEach((id, k) => {
        const q = data[`q${k}`];
        const ok = Number.isFinite(q?.latitude) && Number.isFinite(q?.longitude);
        cache.set(id, { at: now(), ttl: ok ? QUAY_TTL_MS : QUAY_MISS_TTL_MS, xy: ok ? [q.latitude, q.longitude] : null });
      });
    }
  }
  return { get, ensure, size: () => cache.size };
}

async function defaultJpFetch(query) {
  const res = await fetch(JP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`JP ${res.status}`);
  const json = await res.json();
  return json?.data ?? null;
}

/** Laster ned og parser BNR-ET med én tidsgrense for hele svaret (også body). */
async function defaultFetchJourneys() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ET_URL, { headers: { 'ET-Client-Name': CLIENT_NAME }, signal: controller.signal });
    if (!res.ok) {
      try { await res.body?.cancel?.(); } catch { /* ignorer */ }
      const err = new Error(`ET BNR ${res.status}`);
      err.status = res.status;
      throw err;
    }
    const parser = createEtStreamParser({ mode: 'rail', skipCancelled: true });
    const decoder = new TextDecoder();
    if (res.body) for await (const chunk of res.body) parser.push(decoder.decode(chunk, { stream: true }));
    parser.push(decoder.decode());
    return parser.end();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{ fetchJourneys?: () => Promise<object[]>, jpFetch?: Function, now?: () => number,
 *   gtfs?: () => Map|null }} [opts]
 */
export function createRailEtService({
  fetchJourneys = defaultFetchJourneys,
  jpFetch = (q) => defaultJpFetch(q).catch((e) => { console.warn('[RuterLive] BNR quay-oppslag:', e.message); return null; }),
  now = () => Date.now(),
  gtfs = getGtfsQuayCache,
} = {}) {
  let journeys = null;
  let lastFetch = -Infinity;
  let last429 = -Infinity;
  let refreshing = null;
  let lastWarn = -Infinity;
  let computed = null;
  let computedAt = 0;
  const quays = createQuayCoords({ jpFetch, now, gtfs });

  function refresh() {
    if (refreshing) return refreshing;
    if (now() - last429 < BACKOFF_AFTER_429_MS) return Promise.resolve();
    refreshing = (async () => {
      try {
        const parsed = await fetchJourneys();
        for (const j of parsed) Object.freeze(j);
        await quays.ensure(parsed.flatMap((j) => [...j.recordedCalls, ...j.estimatedCalls].map((c) => c.quayId)));
        journeys = parsed;
      } catch (e) {
        if (e?.status === 429) last429 = now();
        if (now() - lastWarn > BACKOFF_AFTER_429_MS) {
          lastWarn = now();
          console.warn('[RuterLive] Tog-ET (BNR):', e.message);
        }
      } finally {
        lastFetch = now();
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /**
   * Interpolerte ET-tog, uten de som har GPS. Avviser aldri; gir [] før første henting.
   * Venter ikke på Entur: henting skjer i bakgrunnen.
   * @param {Set<string>} gpsKeys trainKey for togene med GPS
   */
  function getVehicles(gpsKeys = new Set()) {
    if (now() - lastFetch > REFRESH_MS) refresh();
    if (!journeys) return NO_VEHICLES;
    if (computed && now() - computedAt < COMPUTE_TTL_MS && computed.gpsKeys === gpsKeys) return computed.vehicles;
    const t = now();
    const vehicles = [];
    for (const j of selectRailJourneys(journeys, t, gpsKeys)) {
      const v = railJourneyToVehicle(j, quays.get, t);
      if (v) vehicles.push(v);
    }
    computed = { gpsKeys, vehicles: Object.freeze(vehicles) };
    computedAt = t;
    return computed.vehicles;
  }

  return { getVehicles, refresh, stats: () => ({ journeys: journeys?.length ?? 0, quays: quays.size() }) };
}
