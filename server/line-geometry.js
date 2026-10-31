/**
 * Faktisk trasé (gate/spor) for linjene som alltid vises (T-bane, trikk, tog, flytog) og flybuss.
 * Henter journey patterns med pointsOnLink fra Entur JP for hver linje i line-catalog.js, velger
 * hovedmønsteret i hver retning (pluss vanlige korte varianter), forenkler (Douglas-Peucker) og
 * runder til 5 desimaler. Resultatet erstatter de rette ET-strekene mellom holdeplassene.
 *
 * Per linje caches svaret i 24 t (feil 10 min) med in-flight-dedup. getShapes() gir samme array
 * så lenge innholdet er uendret, så shapesVersion bare byttes når geometrien faktisk endres.
 */

import { LINES, jpQuery } from './line-catalog.js';
import { decodePolyline, simplifyLine } from './polyline.js';
import { hashString } from './json-cache.js';
import { getRegion } from '../shared/regions.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;
/** Douglas-Peucker-toleranse i grader breddegrad (5e-5 ≈ 5,5 m). */
export const GEOMETRY_TOL_DEG = 5e-5;
/** Tog: slakere kurver og lange strekninger, 8e-5 ≈ 9 m holder payloaden under budsjett. */
export const RAIL_TOL_DEG = 8e-5;
export const tolForMode = (mode) => (mode === 'rail' ? RAIL_TOL_DEG : GEOMETRY_TOL_DEG);
/** Varianter (f.eks. korte turer) tas med når de har minst denne andelen av hovedmønsterets turer. */
const VARIANT_SHARE = 0.2;
const MAX_VARIANTS_PER_DIRECTION = 2;

const JP_MODES = {
  metro: ['metro'],
  tram: ['tram'],
  rail: ['rail'],
  flytog: ['rail'],
  flybuss: ['bus', 'coach'],
};

const LINES_QUERY = 'query($codes: [String]) { lines(publicCodes: $codes) { id publicCode transportMode } }';
const LINE_QUERY = `query($id: ID!) { line(id: $id) { id publicCode journeyPatterns {
  quays { id name latitude longitude } pointsOnLink { points } serviceJourneys { id } } } }`;

const round5 = (x) => Math.round(x * 1e5) / 1e5;

function distM(a, b) {
  const k = Math.cos((a[0] * Math.PI) / 180);
  const dy = (b[0] - a[0]) * 111320;
  const dx = (b[1] - a[1]) * 111320 * k;
  return Math.sqrt(dx * dx + dy * dy);
}

/** JP-mønster → { from, to, journeys, stops: [[lat, lon, quayId, name]], enc } eller null. */
export function compactJourneyPattern(p) {
  const stops = [];
  for (const q of p?.quays ?? []) {
    const lat = Number(q?.latitude);
    const lon = Number(q?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stops.push([round5(lat), round5(lon), String(q.id ?? ''), String(q.name ?? '')]);
  }
  const journeys = p?.serviceJourneys?.length ?? 0;
  const enc = typeof p?.pointsOnLink?.points === 'string' ? p.pointsOnLink.points : null;
  if (stops.length < 2 || journeys === 0 || !enc) return null;
  // Endepunkt uten ordentlig navn (f.eks. «-» ved vognhall): bruk nærmeste holdeplass med navn
  const named = stops.filter((s) => /\p{L}/u.test(s[3]));
  const from = (named[0] ?? stops[0])[3];
  const to = (named[named.length - 1] ?? stops[stops.length - 1])[3];
  return { from, to, journeys, stops, enc };
}

const weight = (p) => p.journeys * p.stops.length;
const better = (a, b) => weight(a) > weight(b) || (weight(a) === weight(b) && a.stops.length > b.stops.length);

/** Sann når mønsteret går motsatt vei av `main` (endepunktene ligger nærmest hverandres motsatte ende). */
function isReverseOf(p, main) {
  const pf = p.stops[0], pl = p.stops[p.stops.length - 1];
  const mf = main.stops[0], ml = main.stops[main.stops.length - 1];
  return distM(pf, ml) + distM(pl, mf) < distM(pf, mf) + distM(pl, ml);
}

/**
 * Hovedmønsteret i hver retning (flest turer × holdeplasser, samme regel som pickMainPattern),
 * pluss opptil to vanlige varianter per retning med andre endepunkter (korte turer).
 * Ett mønster per (fra, til).
 */
export function selectPatterns(compact) {
  const pats = (compact ?? []).filter(Boolean);
  if (pats.length === 0) return [];
  let main = pats[0];
  for (const p of pats) if (better(p, main)) main = p;
  const dirs = [[], []];
  for (const p of pats) dirs[p === main || !isReverseOf(p, main) ? 0 : 1].push(p);
  const out = [];
  for (const group of dirs) {
    if (group.length === 0) continue;
    const byEnds = new Map();
    for (const p of group) {
      const k = `${p.from}|${p.to}`;
      const ex = byEnds.get(k);
      if (!ex || better(p, ex)) byEnds.set(k, p);
    }
    const sorted = [...byEnds.values()].sort((a, b) => weight(b) - weight(a) || b.stops.length - a.stops.length);
    const head = sorted[0];
    out.push(head);
    let n = 0;
    for (const p of sorted.slice(1)) {
      if (n >= MAX_VARIANTS_PER_DIRECTION) break;
      if (p.journeys < head.journeys * VARIANT_SHARE) continue;
      p.head = head;
      out.push(p);
      n++;
    }
  }
  return out;
}

/** Forenklet trasé: dekodet, rundet til 5 desimaler, Douglas-Peucker, uten like naboer. */
export function traceFromEncoded(enc, tolDeg = GEOMETRY_TOL_DEG) {
  const raw = decodePolyline(enc).map(([a, b]) => [round5(a), round5(b)]);
  const dedup = raw.filter((p, i) => i === 0 || p[0] !== raw[i - 1][0] || p[1] !== raw[i - 1][1]);
  return simplifyLine(dedup, tolDeg);
}

/**
 * Bygger rutekart for én katalog-linje fra JP-mønstrene.
 * `points` er bare trasé (pointsAreTrace), holdeplassene ligger i `quayStops` ([lat, lon, quayId, navn]).
 */
export function buildLineShapes(line, journeyPatterns, { tolDeg = tolForMode(line.mode), bbox = REGION_BBOX } = {}) {
  const chosen = selectPatterns((journeyPatterns ?? []).map(compactJourneyPattern));
  const shapes = [];
  const traces = new Map();
  for (const p of chosen) {
    // Variant som er en del av hovedmønsteret: samme punkter (komprimeres nesten bort i br)
    const sliced = p.head && traces.get(p.head) ? sliceForVariant(traces.get(p.head), p.head, p) : null;
    const full = sliced ?? traceFromEncoded(p.enc, tolDeg);
    // Flytoget o.l.: pointsOnLink er bare holdeplassene, altså like rett som ET-streken
    if (!sliced && !isRealTrace(full, p.stops.length)) continue;
    if (!p.head) traces.set(p, full);
    const points = clipToBbox(full, bbox);
    if (points.length < 2) continue;
    const stops = bbox ? p.stops.filter((s) => inBbox(s, bbox)) : p.stops;
    const mid = p.stops.length > 2 ? p.stops[Math.floor(p.stops.length / 2)][3] : null;
    shapes.push({
      mode: line.mode,
      line: line.code,
      from: p.from,
      to: p.to,
      via: mid,
      points,
      quayStops: stops,
      pointsAreTrace: true,
    });
  }
  return shapes;
}

const SLICE_MAX_M = 60;

/** Nærmeste punkt på linjen (segmentprojeksjon) fra segment `from` og utover. */
function nearestOnLine(points, pt, from = 0) {
  const k = Math.cos((pt[0] * Math.PI) / 180);
  let best = { seg: -1, t: 0, d: Infinity };
  for (let i = Math.max(0, from); i < points.length - 1; i++) {
    const ax = points[i][1] * k, ay = points[i][0];
    const dx = points[i + 1][1] * k - ax, dy = points[i + 1][0] - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((pt[1] * k - ax) * dx + (pt[0] - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const ex = (ax + t * dx - pt[1] * k) * 111320, ey = (ay + t * dy - pt[0]) * 111320;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best.d) best = { seg: i, t, d };
  }
  return best;
}

const lerpPt = (points, { seg, t }) => {
  const a = points[seg], b = points[seg + 1];
  return [round5(a[0] + t * (b[0] - a[0])), round5(a[1] + t * (b[1] - a[1]))];
};

/**
 * Trasé for en variant (f.eks. kort tur) som utsnitt av hovedmønsterets trasé, når variantens
 * første og siste holdeplass ligger på hovedmønsteret i samme rekkefølge. Ellers null.
 */
export function sliceForVariant(headTrace, head, variant) {
  const same = (a, b) => a[2] === b[2] || (a[3] && a[3] === b[3]);
  const first = variant.stops[0];
  const last = variant.stops[variant.stops.length - 1];
  const fi = head.stops.findIndex((s) => same(s, first));
  if (fi < 0) return null;
  const li = head.stops.findIndex((s, k) => k > fi && same(s, last));
  if (li < 0) return null;
  const a = nearestOnLine(headTrace, first);
  if (a.seg < 0 || a.d > SLICE_MAX_M) return null;
  const b = nearestOnLine(headTrace, last, a.seg);
  if (b.seg < 0 || b.d > SLICE_MAX_M || (b.seg === a.seg && b.t <= a.t)) return null;
  // Mellompunktene er identiske med hovedmønsterets, så br komprimerer dem nesten bort
  const out = [lerpPt(headTrace, a), ...headTrace.slice(a.seg + 1, b.seg + 1), lerpPt(headTrace, b)];
  return out.filter((p, i) => i === 0 || p[0] !== out[i - 1][0] || p[1] !== out[i - 1][1]);
}

/** Sann når traseen har klart flere punkter enn holdeplasser (ikke bare rette streker). */
export function isRealTrace(points, stopCount) {
  return points.length >= Math.max(4, Math.ceil(stopCount * 1.5));
}

/**
 * Stor-Oslo med togstrekningene (Skien, Kongsberg, Eidsvoll, Kongsvinger, Halden).
 * Fjerntogdelene (Lillehammer, Gjøvik, Göteborg) klippes bort for å holde payloaden liten.
 */
export const REGION_BBOX = getRegion().geometryBounds;

const inBbox = (p, b) => p[0] >= b.s && p[0] <= b.n && p[1] >= b.w && p[1] <= b.e;

/**
 * Lengste sammenhengende del av linjen innenfor bbox, med ett punkt utenfor i hver ende så
 * linjen går helt ut til kanten. Uten bbox: uendret.
 */
export function clipToBbox(points, bbox) {
  if (!bbox) return points;
  let best = [0, -1];
  let start = -1;
  for (let i = 0; i <= points.length; i++) {
    const inside = i < points.length && inBbox(points[i], bbox);
    if (inside && start < 0) start = i;
    if (!inside && start >= 0) {
      if (i - 1 - start > best[1] - best[0]) best = [start, i - 1];
      start = -1;
    }
  }
  if (best[1] < 0) return [];
  if (best[0] === 0 && best[1] === points.length - 1) return points;
  return points.slice(Math.max(0, best[0] - 1), Math.min(points.length, best[1] + 2));
}

const lineKey = (mode, line) => `${String(mode || '').toLowerCase()}|${String(line ?? '').toUpperCase()}`;

/**
 * Slår JP-traseene inn i rutekartsettet: for hver modus + linje med JP-trasé fjernes de andre
 * rutekartene (rette ET-streker, eldre tog-/flybusskart) og JP-rutene legges til.
 * Linjer uten JP-trasé beholdes uendret.
 */
export function applyLineGeometry(shapes, geometryShapes) {
  if (!geometryShapes?.length) return shapes ?? [];
  const covered = new Set(geometryShapes.map((s) => lineKey(s.mode, s.line)));
  const out = [];
  for (const s of shapes ?? []) if (!covered.has(lineKey(s.mode, s.line))) out.push(s);
  for (const s of geometryShapes) out.push(s);
  return out;
}

/**
 * @param {{ fetchFn?: Function, now?: () => number, lines?: object[], ttlMs?: number,
 *   failureTtlMs?: number, timeoutMs?: number, tolDeg?: number }} opts
 */
export function createLineGeometryService({
  fetchFn = (...a) => fetch(...a),
  now = () => Date.now(),
  // Tog utenfor Oslo (national) har trasé fra rail-network.js, og her ville de bare blitt klippet bort.
  lines = LINES.filter((l) => !l.national),
  ttlMs = DAY_MS,
  failureTtlMs = FAILURE_TTL_MS,
  timeoutMs = TIMEOUT_MS,
  tolDeg = null, // null: per modus (tolForMode)
} = {}) {
  const perLine = new Map(); // slug -> { at, ttl, shapes: object[] | null }
  let ids = null; // { at, ttl, map: Map<"AUTH:CODE:MODE", id> | null }
  let current = Object.freeze([]);
  let currentHash = hashString('[]');
  let currentBytes = 2;
  let inFlight = null;
  let jpCalls = 0;

  const query = (q, variables) => {
    jpCalls++;
    return jpQuery(q, fetchFn, timeoutMs, variables);
  };

  async function lineIds() {
    if (ids && now() - ids.at < ids.ttl) return ids.map;
    try {
      const codes = [...new Set(lines.map((l) => l.code))];
      const data = await query(LINES_QUERY, { codes });
      const map = new Map();
      for (const l of data?.lines ?? []) {
        const auth = String(l.id).split(':')[0];
        map.set(`${auth}:${String(l.publicCode).toUpperCase()}:${String(l.transportMode || '').toLowerCase()}`, String(l.id));
      }
      ids = { at: now(), ttl: ttlMs, map };
    } catch (e) {
      console.warn('[RuterLive] Linjetrasé, linje-IDer:', e.message);
      ids = { at: now(), ttl: failureTtlMs, map: null };
    }
    return ids.map;
  }

  function idFor(map, line) {
    for (const m of JP_MODES[line.mode] ?? []) {
      const id = map.get(`${line.authority}:${line.code.toUpperCase()}:${m}`);
      if (id) return id;
    }
    return null;
  }

  /** Rutekart for linjen; [] når JP ikke har linjen eller ingen ordentlig trasé (cachet 24 t). */
  async function fetchLine(line, map) {
    const id = idFor(map, line);
    if (!id) return [];
    const data = await query(LINE_QUERY, { id });
    return buildLineShapes(line, data?.line?.journeyPatterns, tolDeg ? { tolDeg } : {});
  }

  function rebuild() {
    const all = [];
    for (const line of lines) {
      const c = perLine.get(line.slug);
      if (c?.shapes) all.push(...c.shapes);
    }
    const json = JSON.stringify(all);
    const hash = hashString(json);
    if (hash !== currentHash) {
      current = Object.freeze(all);
      currentHash = hash;
      currentBytes = json.length;
    }
    return current;
  }

  async function runRefresh(maxAgeMs) {
    const map = await lineIds();
    let failed = 0;
    for (const line of lines) {
      const c = perLine.get(line.slug);
      if (c && now() - c.at < Math.min(c.ttl, maxAgeMs)) continue;
      if (!map) {
        failed++;
        continue;
      }
      try {
        const shapes = await fetchLine(line, map);
        perLine.set(line.slug, { at: now(), ttl: ttlMs, shapes });
      } catch (e) {
        // Feil: kort negativ cache, behold forrige trasé om den finnes
        failed++;
        perLine.set(line.slug, { at: now(), ttl: failureTtlMs, shapes: c?.shapes ?? null });
        console.warn(`[RuterLive] Linjetrasé ${line.slug}:`, e.message);
      }
    }
    const shapes = rebuild();
    console.log(`[RuterLive] Linjetrasé fra JP: ${shapes.length} ruter for ${lines.length} linjer, ${failed} feil (JP-kall totalt: ${jpCalls})`);
    return { shapes, failed };
  }

  return {
    /**
     * Henter linjer som mangler, er utløpt eller eldre enn `maxAgeMs` (døgnlig oppdatering bruker
     * litt under 24 t, ellers hoppes linjene over til neste døgn). Samtidige kall deler samme henting.
     */
    refresh({ maxAgeMs = Infinity } = {}) {
      if (!inFlight) inFlight = runRefresh(maxAgeMs).finally(() => { inFlight = null; });
      return inFlight;
    },
    getShapes: () => current,
    stats: () => ({ lines: perLine.size, shapes: current.length, bytes: currentBytes, jpCalls }),
  };
}
