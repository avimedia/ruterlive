/**
 * Hel rute for valgt buss/båt/flybuss fra Entur Journey Planner (/api/vehicle-route).
 * ET har ofte bare deler av turen, så klienten henter linjens journey pattern i riktig retning her.
 *
 * Per linje caches mønstrene i 24 t (feil 10 min) i en begrenset LRU. Traseen lagres som
 * polyline-streng og dekodes per svar, så cachen holder seg liten. Ferdige JSON-svar
 * (komprimert) caches i en egen liten LRU.
 */

import { jpQuery } from './line-catalog.js';
import { decodePolyline, simplifyLine } from './polyline.js';
import { makeJsonEntry } from './json-cache.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 6000;
const MAX_LINES = 300;
const MAX_ENTRIES = 400;
const MAX_PATTERNS = 30;

const MODES = new Set(['bus', 'water', 'flybuss', 'coach']);
const JP_MODES = { bus: ['bus', 'coach'], flybuss: ['bus', 'coach'], coach: ['bus', 'coach'], water: ['water'] };
const LINE_RE = /^[A-Za-z0-9]{1,10}$/;
const AUTH_RE = /^[A-Z]{3}$/;
const REF_RE = /^([A-Z]{3}):Line:[A-Za-z0-9_.-]{1,64}$/;
const DEST_RE = /^[\p{L}\p{N} .,'()/&+-]{0,100}$/u;

const round5 = (x) => Math.round(x * 1e5) / 1e5;

/**
 * Validerer query-parametre. Verdiene går bare inn som GraphQL-variabler, men vi avviser
 * likevel alt utenfor et smalt tegnsett.
 * @returns {{ ok: true, params: { line, mode, dest, authority, ref } } | { ok: false, error: string }}
 */
export function parseVehicleRouteParams(q = {}) {
  const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : null);
  const line = str(q.line);
  const mode = str(q.mode);
  const dest = str(q.dest);
  const authority = str(q.authority);
  const ref = str(q.ref);
  if ([line, mode, dest, authority, ref].includes(null)) return { ok: false, error: 'ugyldig parameter' };
  if (!LINE_RE.test(line)) return { ok: false, error: 'ugyldig line' };
  if (!MODES.has(mode.toLowerCase())) return { ok: false, error: 'ugyldig mode' };
  if (dest.length > 100 || !DEST_RE.test(dest)) return { ok: false, error: 'ugyldig dest' };
  if (authority && !AUTH_RE.test(authority)) return { ok: false, error: 'ugyldig authority' };
  let m = null;
  if (ref && !(m = REF_RE.exec(ref))) return { ok: false, error: 'ugyldig ref' };
  return {
    ok: true,
    params: {
      line,
      mode: mode.toLowerCase(),
      dest,
      authority: m ? m[1] : authority || null,
      ref: ref || null,
    },
  };
}

/** Samme idé som destMatchesNorm i js/routes.js: små bokstaver, uten tegn, enkle mellomrom. */
export function normDest(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,'()/&+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isAirport = (s) => /gardermoen|lufthavn|\bosl\b/.test(s);

function textScore(text, d, exact, partial) {
  const t = normDest(text);
  if (!t) return 0;
  if (t === d) return exact;
  if (isAirport(d) && isAirport(t)) return partial;
  return t.includes(d) || d.includes(t) ? partial : 0;
}

/**
 * Velger mønsteret som går mot `dest`: frontText (skilt) teller mest, så siste holdeplass.
 * Ved likhet: flest turer × holdeplasser. Tom dest gir hovedmønsteret. Ingen treff gir null.
 * @param {{ to: string, frontTexts: string[], journeys: number, quays: number }[]} patterns
 */
export function pickPatternForDest(patterns, dest) {
  if (!Array.isArray(patterns) || patterns.length === 0) return null;
  const d = normDest(dest);
  let best = null;
  let bestKey = null;
  for (const p of patterns) {
    let score = 1;
    if (d) {
      score = 0;
      for (const t of p.frontTexts ?? []) score = Math.max(score, textScore(t, d, 4, 3));
      score = Math.max(score, textScore(p.to, d, 2, 1));
      if (score === 0) continue;
    }
    const key = [score, (p.journeys ?? 0) * (p.quays ?? 0), p.quays ?? 0];
    if (!bestKey || key[0] > bestKey[0] || (key[0] === bestKey[0] && (key[1] > bestKey[1] || (key[1] === bestKey[1] && key[2] > bestKey[2])))) {
      best = p;
      bestKey = key;
    }
  }
  return best;
}

/** Map som LRU: get flytter nøkkelen bakerst, set kaster den eldste over `max`. */
function lruGet(map, key) {
  const v = map.get(key);
  if (v !== undefined) {
    map.delete(key);
    map.set(key, v);
  }
  return v;
}
function lruSet(map, key, value, max) {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value);
}

const LINES_QUERY = 'query($codes: [String]) { lines(publicCodes: $codes) { id publicCode transportMode } }';
const LINE_QUERY = `query($id: ID!) { line(id: $id) { id publicCode transportMode journeyPatterns {
  quays { id name latitude longitude } pointsOnLink { points } serviceJourneys { id } } } }`;

function frontTextQuery(n) {
  const vars = Array.from({ length: n }, (_, i) => `$s${i}: String!`).join(', ');
  const fields = Array.from({ length: n }, (_, i) =>
    `p${i}: serviceJourney(id: $s${i}) { passingTimes { destinationDisplay { frontText } } }`
  ).join(' ');
  return `query(${vars}) { ${fields} }`;
}

function compactPattern(p) {
  const stops = [];
  for (const q of p?.quays ?? []) {
    const lat = Number(q?.latitude);
    const lon = Number(q?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stops.push([round5(lat), round5(lon), String(q.name ?? ''), String(q.id ?? '')]);
  }
  const journeys = p?.serviceJourneys?.length ?? 0;
  if (stops.length < 2 || journeys === 0) return null;
  return {
    from: stops[0][2],
    to: stops[stops.length - 1][2],
    frontTexts: [],
    journeys,
    quays: stops.length,
    enc: typeof p?.pointsOnLink?.points === 'string' ? p.pointsOnLink.points : null,
    stops,
    sampleJourney: p.serviceJourneys[0]?.id ?? null,
  };
}

/**
 * @param {{ fetchFn?: Function, now?: () => number, ttlMs?: number, failureTtlMs?: number,
 *   maxLines?: number, maxEntries?: number, timeoutMs?: number }} opts
 */
export function createVehicleRouteService({
  fetchFn = (...a) => fetch(...a),
  now = () => Date.now(),
  ttlMs = DAY_MS,
  failureTtlMs = FAILURE_TTL_MS,
  maxLines = MAX_LINES,
  maxEntries = MAX_ENTRIES,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  const lineCache = new Map(); // nøkkel -> { at, ttl, value }
  const idCache = new Map(); // publicCode -> { at, ttl, lines }
  const entryCache = new Map(); // nøkkel|dest -> { lineAt, entry }
  const inFlight = new Map();
  let jpCalls = 0;

  const query = (q, variables) => {
    jpCalls++;
    return jpQuery(q, fetchFn, timeoutMs, variables);
  };

  async function resolveLineId({ line, mode, authority }) {
    let c = lruGet(idCache, line);
    if (!c || now() - c.at >= c.ttl) {
      try {
        const data = await query(LINES_QUERY, { codes: [line] });
        c = { at: now(), ttl: ttlMs, lines: (data?.lines ?? []).map((l) => ({ id: String(l.id), code: String(l.publicCode), mode: String(l.transportMode || '').toLowerCase() })) };
      } catch (e) {
        c = { at: now(), ttl: failureTtlMs, lines: null };
        console.warn(`[RuterLive] Linjeoppslag ${line}:`, e.message);
      }
      lruSet(idCache, line, c, maxLines);
    }
    if (!c.lines) return null;
    const ok = JP_MODES[mode] ?? ['bus'];
    const cands = c.lines.filter((l) => l.code.toUpperCase() === line.toUpperCase() && ok.includes(l.mode));
    const auth = (l) => l.id.split(':')[0];
    if (authority) return cands.find((l) => auth(l) === authority)?.id ?? null;
    return (cands.find((l) => auth(l) === 'RUT') ?? cands[0])?.id ?? null;
  }

  async function fetchLine(params) {
    try {
      const id = params.ref ?? (await resolveLineId(params));
      if (!id) return null;
      const data = await query(LINE_QUERY, { id });
      const patterns = (data?.line?.journeyPatterns ?? [])
        .map(compactPattern)
        .filter(Boolean)
        .sort((a, b) => b.journeys * b.quays - a.journeys * a.quays)
        .slice(0, MAX_PATTERNS);
      if (patterns.length === 0) return null;
      let complete = true;
      const sampled = patterns.filter((p) => p.sampleJourney);
      if (sampled.length) {
        try {
          const vars = Object.fromEntries(sampled.map((p, i) => [`s${i}`, p.sampleJourney]));
          const ft = await query(frontTextQuery(sampled.length), vars);
          sampled.forEach((p, i) => {
            const texts = (ft?.[`p${i}`]?.passingTimes ?? []).map((t) => t?.destinationDisplay?.frontText).filter(Boolean);
            p.frontTexts = [...new Set(texts)];
          });
        } catch (e) {
          complete = false; // Bruk siste holdeplass, men prøv igjen snart
          console.warn(`[RuterLive] Skilttekster ${id}:`, e.message);
        }
      }
      for (const p of patterns) delete p.sampleJourney;
      console.log(`[RuterLive] Rute hentet fra JP: ${id}, ${patterns.length} mønstre (JP-kall totalt: ${jpCalls})`);
      return { value: { id, patterns }, complete };
    } catch (e) {
      console.warn(`[RuterLive] Rute for linje ${params.line}:`, e.message);
      return null;
    }
  }

  const cacheKey = (p) => p.ref ?? `${p.line.toUpperCase()}|${p.mode}|${p.authority ?? ''}`;

  /** @returns {Promise<{ at: number, value: object|null }>} */
  function getLine(params) {
    const key = cacheKey(params);
    const c = lruGet(lineCache, key);
    if (c && now() - c.at < c.ttl) return Promise.resolve(c);
    if (inFlight.has(key)) return inFlight.get(key);
    const p = fetchLine(params)
      .then((r) => {
        const entry = r
          ? { at: now(), ttl: r.complete ? ttlMs : failureTtlMs, value: r.value }
          : { at: now(), ttl: failureTtlMs, value: null };
        lruSet(lineCache, key, entry, maxLines);
        for (const k of entryCache.keys()) if (k.startsWith(`${key}#`)) entryCache.delete(k);
        return entry;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  }

  function buildRoute(params, lineValue) {
    const pattern = pickPatternForDest(lineValue?.patterns, params.dest);
    if (!pattern) return null;
    const raw = pattern.enc ? decodePolyline(pattern.enc) : [];
    const base = raw.length >= 2 ? raw : pattern.stops.map((s) => [s[0], s[1]]);
    const points = simplifyLine(base.map(([a, b]) => [round5(a), round5(b)]));
    return {
      line: params.line,
      mode: params.mode,
      from: pattern.from,
      to: pattern.to,
      points,
      stops: pattern.stops,
    };
  }

  return {
    async getRoute(params) {
      const c = await getLine(params);
      return c.value ? buildRoute(params, c.value) : null;
    },
    /** Ferdig komprimert JSON-entry (eller null), cachet per linje + destinasjon. */
    async getRouteEntry(params) {
      const c = await getLine(params);
      if (!c.value) return null;
      const key = `${cacheKey(params)}#${params.mode}#${params.line}#${normDest(params.dest)}`;
      const hit = lruGet(entryCache, key);
      if (hit && hit.lineAt === c.at) return hit.entry;
      const route = buildRoute(params, c.value);
      const entry = route ? makeJsonEntry(route, null, { brQuality: 9 }) : null;
      lruSet(entryCache, key, { lineAt: c.at, entry }, maxEntries);
      return entry;
    },
    size: () => lineCache.size,
    stats: () => ({ lines: lineCache.size, entries: entryCache.size, jpCalls }),
  };
}
