/**
 * Holdeplassøk og holdeplassinfo for avgangstavla.
 *
 * GTFS (stops.txt) gir quay-navn og koordinater. Entur Journey Planner gir stoppested (gruppering),
 * plattform/retning og linjer per quay; Entur Geocoder gir kommune og fylke per stoppested
 * (JP v3 har ikke topographicPlace). Begge caches per ID i 24 t (LRU-tak, in-flight-dedup,
 * feil og ukjente ID-er 10 min), så gjentatte søk og klikk ikke gir nye kall til Entur.
 */

import { jpQuery } from './line-catalog.js';
import { LruCache } from './stop-service.js';
import { isFlytogLineCode } from '../config.js';

export const INFO_TTL_MS = 24 * 60 * 60 * 1000;
export const NEGATIVE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
const GEOCODER_URL = 'https://api.entur.io/geocoder/v1/place';
export const MAX_CANDIDATES = 40;
export const MAX_PLACES = 12;
/** Quays med samme navn innenfor denne avstanden blir ett sted når JP mangler (reserve). */
const FALLBACK_GROUP_KM = 0.5;

/** Quay-feltene som trengs for gruppering og overskrift; brukes også av /api/departures. */
export const QUAY_INFO_FIELDS = `id
    name
    publicCode
    description
    latitude
    longitude
    stopPlace { id name latitude longitude quays { lines { publicCode transportMode } } }
    lines { publicCode transportMode }`;

const QUAYS_QUERY = `query($ids: [String]!) {
  quays(ids: $ids) {
    ${QUAY_INFO_FIELDS}
  }
}`;

export const MODE_ORDER = ['metro', 'tram', 'rail', 'flytog', 'flybuss', 'bus', 'water'];

/** JP-modus + linjekode → modus slik kartet bruker den (flybuss og flytoget for seg). */
export function lineMode(transportMode, code) {
  const m = String(transportMode || '').toLowerCase();
  const c = String(code || '').toUpperCase();
  if (m === 'bus' || m === 'coach') return c.startsWith('FB') ? 'flybuss' : 'bus';
  if (m === 'rail') return isFlytogLineCode(c) ? 'flytog' : 'rail';
  if (m === 'water' || m === 'ferry') return 'water';
  if (m === 'metro' || m === 'tram') return m;
  return m || 'bus';
}

const modeRank = (m) => {
  const i = MODE_ORDER.indexOf(m);
  return i < 0 ? MODE_ORDER.length : i;
};
const natural = (a, b) => String(a).localeCompare(String(b), 'nb', { numeric: true, sensitivity: 'base' });

/** Unike linjer sortert på modus, deretter linjenummer (numerisk). */
export function sortLines(lines) {
  const seen = new Map();
  for (const l of lines) {
    if (!l?.code) continue;
    const key = `${l.mode}|${l.code.toUpperCase()}`;
    if (!seen.has(key)) seen.set(key, { code: l.code, mode: l.mode });
  }
  return [...seen.values()].sort((a, b) => modeRank(a.mode) - modeRank(b.mode) || natural(a.code, b.code));
}

const parseLines = (lines) =>
  sortLines((lines ?? []).map((l) => ({ code: String(l?.publicCode ?? '').trim(), mode: lineMode(l?.transportMode, l?.publicCode) })));

/** JP-stoppested → navn, midtpunkt og alle linjer på stedet (fra alle quays). */
export function parseStopPlace(sp) {
  if (!sp?.id) return null;
  return {
    id: sp.id,
    name: sp.name ?? '',
    lat: Number.isFinite(sp.latitude) ? sp.latitude : null,
    lon: Number.isFinite(sp.longitude) ? sp.longitude : null,
    lines: Array.isArray(sp.quays) ? parseLines(sp.quays.flatMap((q) => q?.lines ?? [])) : null,
  };
}

/**
 * JP-quay → det vi cacher. places: delt Map per svar, så quays på samme stoppested
 * peker på samme objekt (linjelista lagres én gang).
 */
export function parseQuay(q, places = new Map()) {
  if (!q?.id) return null;
  let stopPlace = null;
  if (q.stopPlace?.id) {
    stopPlace = places.get(q.stopPlace.id) ?? parseStopPlace(q.stopPlace);
    places.set(stopPlace.id, stopPlace);
  }
  return {
    id: q.id,
    name: q.name ?? '',
    publicCode: String(q.publicCode ?? '').trim(),
    description: String(q.description ?? '').trim(),
    lat: Number.isFinite(q.latitude) ? q.latitude : null,
    lon: Number.isFinite(q.longitude) ? q.longitude : null,
    stopPlace,
    lines: parseLines(q.lines),
  };
}

export function distanceKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 0 = samme navn, 1 = navnet starter med søket, 2 = et ord starter med det, 3 = inneholder, -1 = ikke treff. */
export function matchTier(name, term) {
  const n = String(name || '').toLowerCase();
  if (!term || !n.includes(term)) return -1;
  if (n === term) return 0;
  if (n.startsWith(term)) return 1;
  if (n.split(/[\s\-/(),.]+/).some((w) => w.startsWith(term))) return 2;
  return 3;
}

function validCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/**
 * Kandidat-quays fra GTFS: beste treffnivå først, så nærmest (med posisjon) eller alfabetisk.
 * @param {Map<string, {lat, lon, name}>|Iterable<[string, {lat, lon, name}]>} stops
 */
export function findCandidates(stops, q, { lat, lng, limit = MAX_CANDIDATES } = {}) {
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 2 || !stops) return [];
  const hasPos = validCoord(lat, lng);
  const out = [];
  for (const [id, v] of stops) {
    const tier = matchTier(v.name, term);
    if (tier < 0) continue;
    out.push({ id, lat: v.lat, lon: v.lon, name: v.name || 'Holdeplass', tier, dist: hasPos ? distanceKm(lat, lng, v.lat, v.lon) : 0 });
  }
  out.sort((a, b) => a.tier - b.tier || (hasPos ? a.dist - b.dist : 0) || natural(a.name, b.name) || natural(a.id, b.id));
  return out.slice(0, limit);
}

/** Kommune, med fylke bare når samme kommunenavn finnes i flere fylker blant treffene. */
export function applyLocalities(places, localities) {
  const counties = new Map();
  for (const p of places) {
    const loc = p.stopPlaceId ? localities.get(p.stopPlaceId) : null;
    if (!loc?.locality) continue;
    const set = counties.get(loc.locality) ?? new Set();
    if (loc.county) set.add(loc.county);
    counties.set(loc.locality, set);
  }
  for (const p of places) {
    const loc = p.stopPlaceId ? localities.get(p.stopPlaceId) : null;
    p.locality = formatLocality(loc, (counties.get(loc?.locality)?.size ?? 0) > 1);
  }
  return places;
}

export function formatLocality(loc, withCounty = false) {
  if (!loc?.locality) return null;
  if (withCounty && loc.county && loc.county !== loc.locality) return `${loc.locality}, ${loc.county}`;
  return loc.locality;
}

function mean(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/**
 * Grupperer kandidat-quays per stoppested (JP). Quays JP ikke kjenner grupperes på navn og nærhet.
 * @param {object[]} candidates fra findCandidates
 * @param {Map<string, object|null>} infos quayId → parseQuay-resultat (null = ukjent)
 */
export function groupPlaces(candidates, infos) {
  const places = new Map();
  const loose = [];
  for (const c of candidates) {
    const info = infos.get(c.id);
    const spId = info?.stopPlace?.id;
    if (!spId) {
      loose.push(c);
      continue;
    }
    let p = places.get(spId);
    if (!p) {
      p = { stopPlaceId: spId, name: info.stopPlace.name || c.name, sp: info.stopPlace, tier: c.tier, quays: [] };
      places.set(spId, p);
    }
    p.tier = Math.min(p.tier, c.tier);
    p.quays.push({
      id: c.id,
      publicCode: info.publicCode,
      description: info.description,
      lat: c.lat,
      lon: c.lon,
      lines: info.lines,
    });
  }
  const out = [...places.values()];
  for (const c of loose) {
    const near = out.find((p) => !p.stopPlaceId && p.name === c.name && distanceKm(p.quays[0].lat, p.quays[0].lon, c.lat, c.lon) < FALLBACK_GROUP_KM);
    const quay = { id: c.id, publicCode: '', description: '', lat: c.lat, lon: c.lon, lines: [] };
    if (near) {
      near.quays.push(quay);
      near.tier = Math.min(near.tier, c.tier);
    } else out.push({ stopPlaceId: null, name: c.name, sp: null, tier: c.tier, quays: [quay] });
  }
  return out.map((p) => {
    const lines = p.sp?.lines?.length ? p.sp.lines : sortLines(p.quays.flatMap((q) => q.lines));
    const lat = Number.isFinite(p.sp?.lat) ? p.sp.lat : mean(p.quays.map((q) => q.lat));
    const lon = Number.isFinite(p.sp?.lon) ? p.sp.lon : mean(p.quays.map((q) => q.lon));
    return {
      stopPlaceId: p.stopPlaceId,
      name: p.name,
      tier: p.tier,
      lat,
      lon,
      modes: [...new Set(lines.map((l) => l.mode))],
      lines,
      quays: p.quays.map((q) => ({ ...q, lines: q.lines.map((l) => l.code) })),
    };
  });
}

/** Sorterer (treffnivå, så avstand eller navn) og kutter til maks antall; legger på distanceKm og displayName. */
export function finishPlaces(places, { lat, lng, limit = MAX_PLACES } = {}) {
  const hasPos = validCoord(lat, lng);
  for (const p of places) p.distanceKm = hasPos ? Math.round(distanceKm(lat, lng, p.lat, p.lon) * 10) / 10 : null;
  places.sort(
    (a, b) =>
      a.tier - b.tier ||
      (hasPos ? a.distanceKm - b.distanceKm : 0) ||
      natural(a.name, b.name) ||
      natural(a.locality || '', b.locality || '')
  );
  return places.slice(0, limit).map(({ tier, ...p }) => ({
    id: p.quays[0]?.id ?? null, // bakoverkompatibelt: første quay
    ...p,
    displayName: p.locality ? `${p.name} (${p.locality})` : p.name,
  }));
}

/** Overskrift for avgangstavla: stoppested (flest quays), kommune og alle linjer. */
export function placeHeader(quayIds, infos, localities) {
  const known = quayIds.map((id) => infos.get(id)).filter(Boolean);
  if (known.length === 0) return null;
  const count = new Map();
  for (const q of known) if (q.stopPlace?.id) count.set(q.stopPlace.id, (count.get(q.stopPlace.id) ?? 0) + 1);
  const mainId = [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const main = known.find((q) => q.stopPlace?.id === mainId);
  // Linjene på hele stoppestedet (alle quays), så tavla viser det samme fra søk og kart
  const places = [...new Map(known.filter((q) => q.stopPlace?.lines).map((q) => [q.stopPlace.id, q.stopPlace])).values()];
  const lines = sortLines([...places.flatMap((p) => p.lines), ...known.flatMap((q) => q.lines)]);
  return {
    stopPlaceId: mainId,
    name: main?.stopPlace?.name || known[0].name || null,
    locality: formatLocality(mainId ? localities.get(mainId) : null),
    modes: [...new Set(lines.map((l) => l.mode))],
    lines,
  };
}

async function fetchJson(url, fetchFn, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`tidsavbrudd etter ${timeoutMs} ms`));
    }, timeoutMs);
  });
  const request = (async () => {
    const res = await fetchFn(url, { headers: { 'ET-Client-Name': 'ruterlive-web' }, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cache per ID med samlet henting av det som mangler: ett kall for alle ukjente ID-er,
 * ID-er som allerede hentes deler det kallet. load(ids) gir Map<id, verdi>; mangler = negativt.
 */
function createBatchCache({ name, load, now, ttlMs, negativeTtlMs, maxEntries }) {
  const cache = new LruCache(maxEntries);
  const inFlight = new Map();

  function set(id, value) {
    cache.set(id, { at: now(), value: value ?? null });
  }

  async function getMany(ids) {
    const out = new Map();
    const waits = [];
    const missing = [];
    for (const id of new Set(ids)) {
      const hit = cache.get(id);
      if (hit && now() - hit.at < (hit.value ? ttlMs : negativeTtlMs)) out.set(id, hit.value);
      else if (inFlight.has(id)) waits.push(inFlight.get(id).then((m) => out.set(id, m.get(id) ?? null)));
      else missing.push(id);
    }
    if (missing.length) {
      const p = load(missing)
        .catch((e) => {
          console.warn(`[RuterLive] Holdeplassøk ${name}:`, e.message);
          return new Map();
        })
        .then((m) => {
          for (const id of missing) set(id, m.get(id));
          return m;
        })
        .finally(() => {
          for (const id of missing) if (inFlight.get(id) === p) inFlight.delete(id);
        });
      for (const id of missing) inFlight.set(id, p);
      waits.push(p.then((m) => { for (const id of missing) out.set(id, m.get(id) ?? null); }));
    }
    await Promise.all(waits);
    return out;
  }

  return { getMany, set, get size() { return cache.size; } };
}

/**
 * @param {{ fetchFn?: typeof fetch, now?: () => number, timeoutMs?: number, maxQuays?: number, maxPlaces?: number }} opts
 */
export function createStopPlaceLookup({ fetchFn = fetch, now = Date.now, timeoutMs = TIMEOUT_MS, maxQuays = 3000, maxPlaces = 1500 } = {}) {
  const stats = { jp: 0, geocoder: 0 };

  const quays = createBatchCache({
    name: 'JP',
    now,
    ttlMs: INFO_TTL_MS,
    negativeTtlMs: NEGATIVE_TTL_MS,
    maxEntries: maxQuays,
    load: async (ids) => {
      stats.jp++;
      const data = await jpQuery(QUAYS_QUERY, fetchFn, timeoutMs, { ids });
      const m = new Map();
      const places = new Map();
      for (const q of data?.quays ?? []) {
        const info = parseQuay(q, places);
        if (info) m.set(info.id, info);
      }
      return m;
    },
  });

  const localities = createBatchCache({
    name: 'geocoder',
    now,
    ttlMs: INFO_TTL_MS,
    negativeTtlMs: NEGATIVE_TTL_MS,
    maxEntries: maxPlaces,
    load: async (ids) => {
      stats.geocoder++;
      const data = await fetchJson(`${GEOCODER_URL}?ids=${ids.map(encodeURIComponent).join(',')}`, fetchFn, timeoutMs);
      const m = new Map();
      for (const f of data?.features ?? []) {
        const p = f?.properties;
        if (p?.id && p.locality) m.set(p.id, { locality: p.locality, county: p.county || null });
      }
      return m;
    },
  });

  /** Legg JP-quays (f.eks. fra avgangskallet) i cachen, så overskriften ikke trenger eget kall. */
  function seedQuays(jpQuays, requestedIds = []) {
    const found = new Set();
    const places = new Map();
    for (const q of jpQuays ?? []) {
      const info = parseQuay(q, places);
      if (info) {
        quays.set(info.id, info);
        found.add(info.id);
      }
    }
    // Ukjente quays caches som negative, så overskriften ikke gir et nytt JP-kall for dem
    for (const id of requestedIds) if (!found.has(id)) quays.set(id, null);
  }

  async function localitiesFor(infos) {
    const spIds = [...new Set([...infos.values()].map((q) => q?.stopPlace?.id).filter(Boolean))];
    return spIds.length ? localities.getMany(spIds) : new Map();
  }

  /** Søk: én JP-forespørsel og én geocoder-forespørsel for det som ikke er cachet. */
  async function search(stops, q, { lat, lng } = {}) {
    const candidates = findCandidates(stops, q, { lat, lng });
    if (candidates.length === 0) return [];
    const infos = await quays.getMany(candidates.map((c) => c.id));
    const places = groupPlaces(candidates, infos);
    const locs = await localitiesFor(infos);
    applyLocalities(places, locs);
    return finishPlaces(places, { lat, lng });
  }

  /** Overskrift for tavla ut fra quays (cachet; ukjente hentes i ett kall). */
  async function header(quayIds) {
    const infos = await quays.getMany(quayIds);
    const locs = await localitiesFor(infos);
    return placeHeader(quayIds, infos, locs);
  }

  return { search, header, seedQuays, getQuays: quays.getMany, stats };
}
