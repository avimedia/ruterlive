/**
 * Avgangstavla bak /api/departures.
 *
 * En kartmarkør kjenner bare quayene den ble tegnet fra (f.eks. to av fire ramper på Bjerke, eller
 * én av to retninger på en vanlig bussholdeplass). Derfor utvides quayene til hele stoppestedet:
 * stoppestedet og dets quays kommer fra quay-cachen i stop-search.js (24 t), og avgangene for alle
 * quays hentes i ett JP-kall (quays(ids:)). Svaret caches per quay-sett i 30 s med in-flight-dedup,
 * så to markører på samme stoppested og gjentatte trykk deler samme kall til Entur.
 */

import { LruCache } from './stop-service.js';

export const DEPARTURES_TTL_MS = 30_000;
/** Samme grense som før: maks quays i ett JP-kall (og i ?quayId=). */
export const MAX_QUAYS = 30;
/** Maks avganger i svaret totalt. */
export const TOTAL_CAP = 36;
const TIME_RANGE_S = 21600; // 6 t fram
const TIMEOUT_MS = 8000;

/** Avganger per quay: 24 fordelt på quayene, minst 3 (knutepunkter med mange quays får 3 hver). */
export function perQuayCount(n) {
  return Math.max(3, Math.ceil(24 / Math.max(1, n)));
}

/**
 * Quay-ID-er → alle quays på stoppestedene de hører til. De forespurte først (så de alltid er med
 * under taket), så resten i JP-rekkefølge. Ukjente quays (ingen stoppested) står som de er.
 * @param {string[]} ids
 * @param {Map<string, object|null>} infos quayId → parseQuay-resultat
 */
export function expandQuayIds(ids, infos, max = MAX_QUAYS) {
  const out = [...new Set(ids)];
  const seen = new Set(out);
  const placeIds = new Set();
  for (const id of ids) {
    const sp = infos?.get(id)?.stopPlace;
    if (!sp?.id) continue;
    placeIds.add(sp.id);
    for (const q of sp.quayIds ?? []) {
      if (!seen.has(q)) {
        seen.add(q);
        out.push(q);
      }
    }
  }
  return { quayIds: out.slice(0, max), placeIds: [...placeIds].sort() };
}

function depTime(c) {
  const t = c?.expectedDepartureTime || c?.aimedDepartureTime;
  return t ? new Date(t).getTime() || 0 : 0;
}

/**
 * Sorterer avgangene per quay etter forventet tid og kutter til cap totalt: runde for runde
 * (første avgang fra hver quay, så andre …), så ingen retning faller ut.
 * @param {{ id: string, calls: object[] }[]} quays
 * @returns {Map<string, object[]>}
 */
export function trimCalls(quays, cap = TOTAL_CAP) {
  const sorted = quays.map((q) => ({ id: q.id, calls: [...(q.calls ?? [])].sort((a, b) => depTime(a) - depTime(b)) }));
  const out = new Map(sorted.map((q) => [q.id, []]));
  let total = 0;
  for (let i = 0; total < cap; i++) {
    let any = false;
    for (const q of sorted) {
      if (i >= q.calls.length) continue;
      any = true;
      out.get(q.id).push(q.calls[i]);
      if (++total >= cap) break;
    }
    if (!any) break;
  }
  return out;
}

function departuresQuery(numberOfDepartures) {
  return `query($ids: [String]!) {
  quays(ids: $ids) {
    id
    name
    publicCode
    description
    latitude
    longitude
    lines { publicCode transportMode }
    estimatedCalls(timeRange: ${TIME_RANGE_S}, numberOfDepartures: ${numberOfDepartures}) {
      realtime
      aimedDepartureTime
      expectedDepartureTime
      destinationDisplay { frontText }
      serviceJourney { journeyPattern { line { publicCode transportMode } } }
    }
  }
}`;
}

/**
 * @param {{ lookup: { getQuays: Function, header: Function }, jpQueryFn: Function, fetchFn?: typeof fetch,
 *   now?: () => number, ttlMs?: number, maxEntries?: number }} opts
 */
export function createDepartureBoard({ lookup, jpQueryFn, fetchFn = fetch, now = Date.now, ttlMs = DEPARTURES_TTL_MS, maxEntries = 300 }) {
  const cache = new LruCache(maxEntries);
  const inFlight = new Map();
  const stats = { jp: 0 };

  async function load(quayIds, headerIds, placeOf) {
    stats.jp++;
    const data = await jpQueryFn(departuresQuery(perQuayCount(quayIds.length)), fetchFn, TIMEOUT_MS, { ids: quayIds });
    const quays = (data?.quays ?? []).filter((q) => q?.id);
    // De andre quayene på stoppestedet i quay-cachen, så trykk på en annen markør der ikke gir nytt oppslag
    const known = quays.filter((q) => placeOf.has(q.id));
    if (known.length && lookup.seedQuays) {
      const places = new Map(known.map((q) => [placeOf.get(q.id).id, placeOf.get(q.id)]));
      lookup.seedQuays(known.map(({ estimatedCalls, ...q }) => ({ ...q, stopPlace: { id: placeOf.get(q.id).id } })), [], places);
    }
    const trimmed = trimCalls(quays.map((q) => ({ id: q.id, calls: q.estimatedCalls })));
    const place = await lookup.header(headerIds).catch(() => null);
    return {
      name: place?.name ?? quays.find((q) => q.name)?.name ?? null,
      place,
      quays: quays.map((q) => ({
        id: q.id,
        name: q.name ?? null,
        publicCode: String(q.publicCode ?? '').trim() || null,
        description: String(q.description ?? '').trim() || null,
      })),
      estimatedCalls: quays.flatMap((q) => trimmed.get(q.id).map((c) => ({ ...c, quayId: q.id }))),
    };
  }

  /**
   * @param {string[]} ids gyldige quay-ID-er (maks MAX_QUAYS)
   * @param {{ expand?: boolean }} opts expand=false: bare de gitte quayene
   */
  async function get(ids, { expand = true } = {}) {
    let quayIds = [...new Set(ids)].slice(0, MAX_QUAYS);
    const placeOf = new Map(); // quayId → tolket stoppested (fra quay-cachen)
    if (expand) {
      const infos = await lookup.getQuays(quayIds).catch(() => new Map());
      quayIds = expandQuayIds(quayIds, infos).quayIds;
      for (const info of infos.values()) {
        const sp = info?.stopPlace;
        for (const q of sp?.quayIds ?? []) if (!placeOf.has(q)) placeOf.set(q, sp);
      }
    }
    const key = [...quayIds].sort().join(',');
    const hit = cache.get(key);
    let value;
    if (hit && now() - hit.at < ttlMs) value = hit.value;
    else {
      let p = inFlight.get(key);
      if (!p) {
        p = load(quayIds, ids, placeOf)
          .then((v) => {
            cache.set(key, { at: now(), value: v });
            return v;
          })
          .finally(() => inFlight.delete(key));
        inFlight.set(key, p);
      }
      value = await p;
    }
    return { id: ids[0], ...value };
  }

  return { get, stats };
}
