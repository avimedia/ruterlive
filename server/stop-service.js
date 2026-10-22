/**
 * Data til holdeplassidene fra Entur Journey Planner, delt cache for alle brukere:
 * - statisk info (linjer, sone, antall plattformer): 24 t, feil 60 s
 * - avganger: 60 s per holdeplass, feil 20 s
 * Begge med in-flight-dedup per holdeplass og LRU-tak på antall holdeplasser i minnet.
 */

import { jpQuery } from './line-catalog.js';

const INFO_TTL_MS = 24 * 60 * 60 * 1000;
const INFO_FAIL_TTL_MS = 60 * 1000;
const DEP_TTL_MS = 60 * 1000;
const DEP_FAIL_TTL_MS = 20 * 1000;
const MAX_ENTRIES = 200;
const TIMEOUT_MS = 5000;
export const NUM_DEPARTURES = 12;
const TIME_RANGE_S = 3 * 60 * 60;

const INFO_QUERY = `query($id: String!) {
  stopPlace(id: $id) {
    id
    name
    tariffZones { id name }
    quays { id publicCode lines { id publicCode name transportMode } }
  }
}`;

const DEP_QUERY = `query($id: String!, $n: Int!, $range: Int!) {
  stopPlace(id: $id) {
    estimatedCalls(numberOfDepartures: $n, timeRange: $range) {
      realtime
      cancellation
      aimedDepartureTime
      expectedDepartureTime
      quay { publicCode }
      destinationDisplay { frontText }
      serviceJourney { line { id publicCode transportMode } }
    }
  }
}`;

/** Enkel LRU over Map (innsettingsrekkefølge): get flytter bakerst, set kaster eldste. */
export class LruCache {
  constructor(max = MAX_ENTRIES) {
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const v = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  get size() {
    return this.map.size;
  }
}

/** Gjør JP-stopplace om til linjer og soner for siden. */
export function parseStopInfo(sp) {
  if (!sp) return null;
  const lines = new Map();
  for (const q of sp.quays ?? []) {
    for (const l of q?.lines ?? []) {
      if (l?.id && !lines.has(l.id)) {
        lines.set(l.id, { id: l.id, publicCode: l.publicCode ?? '', name: l.name ?? '', transportMode: l.transportMode ?? '' });
      }
    }
  }
  // Ruters soner (RUT:TariffZone:*), f.eks. «1», «2V».
  const zones = [...new Set((sp.tariffZones ?? [])
    .filter((z) => String(z?.id).startsWith('RUT:TariffZone:'))
    .map((z) => z.name))];
  return { lines: [...lines.values()], zones, quayCount: (sp.quays ?? []).length };
}

export function parseDepartures(sp) {
  return (sp?.estimatedCalls ?? []).map((c) => ({
    aimed: c.aimedDepartureTime,
    expected: c.expectedDepartureTime ?? c.aimedDepartureTime,
    realtime: Boolean(c.realtime),
    cancelled: Boolean(c.cancellation),
    platform: c.quay?.publicCode ?? '',
    destination: c.destinationDisplay?.frontText ?? '',
    line: {
      id: c.serviceJourney?.line?.id ?? '',
      publicCode: c.serviceJourney?.line?.publicCode ?? '',
      transportMode: c.serviceJourney?.line?.transportMode ?? '',
    },
  }));
}

/**
 * @param {{ fetchFn?: typeof fetch, now?: () => number, timeoutMs?: number, maxEntries?: number }} opts
 */
export function createStopService({ fetchFn = fetch, now = Date.now, timeoutMs = TIMEOUT_MS, maxEntries = MAX_ENTRIES } = {}) {
  const stats = { requests: 0 };

  function cached(name, ttl, failTtl, load) {
    const cache = new LruCache(maxEntries);
    const inFlight = new Map();
    return (stop) => {
      const hit = cache.get(stop.id);
      if (hit && now() - hit.at < (hit.value ? ttl : failTtl)) return Promise.resolve(hit.value);
      if (inFlight.has(stop.id)) return inFlight.get(stop.id);
      stats.requests++;
      const p = load(stop)
        .catch((e) => {
          console.warn(`[RuterLive] Holdeplass ${name} ${stop.id}:`, e.message);
          return null;
        })
        .then((value) => {
          cache.set(stop.id, { at: now(), value });
          return value;
        })
        .finally(() => inFlight.delete(stop.id));
      inFlight.set(stop.id, p);
      return p;
    };
  }

  const getInfo = cached('info', INFO_TTL_MS, INFO_FAIL_TTL_MS, async (stop) => {
    const data = await jpQuery(INFO_QUERY, fetchFn, timeoutMs, { id: stop.id });
    return parseStopInfo(data?.stopPlace);
  });

  const getDepartures = cached('avganger', DEP_TTL_MS, DEP_FAIL_TTL_MS, async (stop) => {
    const data = await jpQuery(DEP_QUERY, fetchFn, timeoutMs, { id: stop.id, n: NUM_DEPARTURES, range: TIME_RANGE_S });
    if (!data?.stopPlace) throw new Error('fant ikke holdeplassen');
    return { fetchedAt: new Date(now()).toISOString(), departures: parseDepartures(data.stopPlace) };
  });

  return { getInfo, getDepartures, stats };
}
