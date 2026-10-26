/**
 * Togrutene i hele Norge fra Entur Journey Planner: alle togLinjer (`lines(transportModes: [rail])`)
 * fra norske togselskap, hovedmønsteret i hver retning (+ vanlige korte varianter, samme utvalg som
 * line-geometry.js) med pointsOnLink som faktisk sportrasé.
 *
 * JP-kall i to steg per linje, så vi slipper å laste ned trasé for alle mønstrene (F4 har ~50
 * mønstre og 2 MB med trasé): først holdeplasser og antall turer per mønster, så pointsOnLink bare
 * for de valgte mønstrene. Ett kall om gangen med pause mellom, hentes ved oppstart og hvert døgn.
 * Feilede linjer beholder forrige resultat.
 *
 * Resultatet har samme format som line-geometry.js (pointsAreTrace, quayStops) og legges inn med
 * applyLineGeometry etter katalogtraseene, så hele linjen (ikke bare Oslo-utsnittet) vises.
 */

import { isFlytogLineCode } from '../config.js';
import { jpQuery } from './line-catalog.js';
import {
  compactJourneyPattern,
  selectPatterns,
  traceFromEncoded,
  sliceForVariant,
  isRealTrace,
  RAIL_TOL_DEG,
} from './line-geometry.js';
import { hashString } from './json-cache.js';
import { simplifyLine } from './polyline.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 20000;
const PAUSE_MS = 400;
/** Samme toleranse som togene i line-geometry.js (≈ 9 m), så Oslo-området ser likt ut som før. */
export const NATIONAL_RAIL_TOL_DEG = RAIL_TOL_DEG;
/** Norske togselskap i JP: Vy, Go-Ahead, Flytoget, SJ Norge. Svenske/danske/tyske linjer tas ikke med. */
export const RAIL_AUTHORITIES = new Set(['VYG', 'GOA', 'FLT', 'SJN']);

const LINES_QUERY = '{ lines(transportModes: [rail]) { id publicCode } }';
const PATTERNS_QUERY = `query($id: ID!) { line(id: $id) { id publicCode journeyPatterns {
  quays { id name latitude longitude } serviceJourneys { id transportMode } } } }`;

/** Linjene vi viser: norsk selskap og en linjekode. Sortert for stabil rekkefølge. */
export function pickRailLines(lines) {
  const out = [];
  const seen = new Set();
  for (const l of lines ?? []) {
    const id = String(l?.id ?? '');
    const code = String(l?.publicCode ?? '').trim();
    if (!code || !RAIL_AUTHORITIES.has(id.split(':')[0]) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, code, mode: isFlytogLineCode(code) ? 'flytog' : 'rail' });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Togtur, ikke buss for tog (railReplacementBus har transportMode bus). Mangler modus: tog. */
const isRailPattern = (p) => {
  const m = String(p?.serviceJourneys?.[0]?.transportMode ?? 'rail').toLowerCase();
  return m === 'rail';
};

/**
 * Velger mønstre fra JP-svaret uten trasé (enc fylles inn etterpå). Gir [{ id, pattern }] i valgt
 * rekkefølge, der id er én tur (serviceJourney) i mønsteret: JP v3 har ikke journeyPattern(id).
 * Buss for tog hoppes over. Fjerntog har ofte ett mønster per tur (litt ulike stopp), så mønstre med
 * samme endepunkter slås sammen: turene summeres, og mønsteret med flest holdeplasser representerer dem.
 */
export function choosePatterns(journeyPatterns) {
  const byEnds = new Map();
  for (const p of journeyPatterns ?? []) {
    if (!isRailPattern(p)) continue;
    const c = compactJourneyPattern({ ...p, pointsOnLink: { points: '?' } });
    const sj = p?.serviceJourneys?.[0]?.id;
    if (!c || !sj) continue;
    const k = `${c.from}|${c.to}`;
    const ex = byEnds.get(k);
    if (!ex) {
      byEnds.set(k, { c, sj: String(sj) });
      continue;
    }
    const journeys = ex.c.journeys + c.journeys;
    if (c.stops.length > ex.c.stops.length) byEnds.set(k, { c: { ...c, journeys }, sj: String(sj) });
    else ex.c.journeys = journeys;
  }
  const idOf = new Map([...byEnds.values()].map(({ c, sj }) => [c, sj]));
  return selectPatterns([...idOf.keys()]).map((c) => ({ id: idOf.get(c), pattern: c }));
}

const shapeOf = (line, p, points) => ({
  mode: line.mode,
  line: line.code,
  from: p.from,
  to: p.to,
  via: p.stops.length > 2 ? p.stops[Math.floor(p.stops.length / 2)][3] : null,
  points,
  quayStops: p.stops,
  pointsAreTrace: true,
});

/**
 * Rutekart for én linje fra valgte mønstre og deres pointsOnLink (id → kodet polyline).
 * Varianter som ligger på hovedmønsteret blir utsnitt av det (komprimeres nesten bort i br).
 * Mønstre uten ordentlig trasé (Flytoget: pointsOnLink er bare holdeplassene) havner i `unsnapped`
 * og legges senere på sporene til andre linjer (snapToNetwork).
 */
export function buildRailShapes(line, chosen, encById, { tolDeg = NATIONAL_RAIL_TOL_DEG } = {}) {
  const shapes = [];
  const unsnapped = [];
  const traces = new Map();
  for (const { id, pattern: p } of chosen ?? []) {
    const enc = encById.get(id);
    const sliced = p.head && traces.get(p.head) ? sliceForVariant(traces.get(p.head), p.head, p) : null;
    if (!sliced && !enc) continue;
    const points = sliced ?? traceFromEncoded(enc, tolDeg);
    if (!sliced && !isRealTrace(points, p.stops.length)) {
      unsnapped.push(p);
      continue;
    }
    if (!p.head) traces.set(p, points);
    if (points.length < 2) continue;
    shapes.push(shapeOf(line, p, points));
  }
  return { shapes, unsnapped };
}

const M_PER_DEG = 111320;

/** Nærmeste punkt på linjen (segmentprojeksjon) fra segment `from`: { seg, t, d (meter) }. */
function nearestOnLine(points, pt, from = 0) {
  const k = Math.cos((pt[0] * Math.PI) / 180);
  let best = { seg: -1, t: 0, d: Infinity };
  for (let i = Math.max(0, from); i < points.length - 1; i++) {
    const ax = points[i][1] * k, ay = points[i][0];
    const dx = points[i + 1][1] * k - ax, dy = points[i + 1][0] - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((pt[1] * k - ax) * dx + (pt[0] - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const ex = (ax + t * dx - pt[1] * k) * M_PER_DEG, ey = (ay + t * dy - pt[0]) * M_PER_DEG;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best.d) best = { seg: i, t, d };
  }
  return best;
}

const round5 = (x) => Math.round(x * 1e5) / 1e5;
const lerpPt = (points, { seg, t }) => {
  const a = points[seg], b = points[seg + 1];
  return [round5(a[0] + t * (b[0] - a[0])), round5(a[1] + t * (b[1] - a[1]))];
};

function lengthM(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const k = Math.cos((points[i][0] * Math.PI) / 180);
    const dy = (points[i][0] - points[i - 1][0]) * M_PER_DEG;
    const dx = (points[i][1] - points[i - 1][1]) * M_PER_DEG * k;
    sum += Math.sqrt(dx * dx + dy * dy);
  }
  return sum;
}

function bboxOf(points) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    if (p[0] < b[0]) b[0] = p[0];
    if (p[1] < b[1]) b[1] = p[1];
    if (p[0] > b[2]) b[2] = p[0];
    if (p[1] > b[3]) b[3] = p[1];
  }
  return b;
}
const SNAP_PAD_DEG = 0.003; // ~300 m
const nearBox = (b, p) => p[0] >= b[0] - SNAP_PAD_DEG && p[0] <= b[2] + SNAP_PAD_DEG
  && p[1] >= b[1] - SNAP_PAD_DEG * 2 && p[1] <= b[3] + SNAP_PAD_DEG * 2;

/**
 * Legger en rute med bare holdeplasser på sporene til andre togruter: for hvert par nabostopp velges
 * den korteste delen av en trasé som går innom begge (≤ maxM meter unna) i riktig rekkefølge.
 * Par uten treff blir rett strek. Gir null når ingen par traff (ingen forbedring).
 * @param {Array<[number, number]>} stops
 * @param {Array<Array<[number, number]>>} traces
 */
export function snapToNetwork(stops, traces, { maxM = 150 } = {}) {
  if (!stops?.length || stops.length < 2) return null;
  const indexed = (traces ?? []).filter((t) => t?.length >= 2).map((t) => ({ t, box: bboxOf(t) }));
  const out = [[stops[0][0], stops[0][1]]];
  let hits = 0;
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i], b = stops[i + 1];
    let best = null;
    for (const { t, box } of indexed) {
      if (!nearBox(box, a) || !nearBox(box, b)) continue;
      const pa = nearestOnLine(t, a);
      if (pa.d > maxM) continue;
      const pb = nearestOnLine(t, b, pa.seg);
      if (pb.d > maxM || (pb.seg === pa.seg && pb.t <= pa.t)) continue;
      const piece = [lerpPt(t, pa), ...t.slice(pa.seg + 1, pb.seg + 1), lerpPt(t, pb)];
      const len = lengthM(piece);
      if (!best || len < best.len) best = { piece, len };
    }
    if (best) hits++;
    const piece = best ? best.piece : [[b[0], b[1]]];
    for (const p of piece) {
      const last = out[out.length - 1];
      if (p[0] !== last[0] || p[1] !== last[1]) out.push(p);
    }
  }
  return hits > 0 ? out : null;
}

/** Legger mønstrene uten trasé (Flytoget) på de andre linjenes spor. */
export function snapUnsnapped(pending, shapes, { tolDeg = NATIONAL_RAIL_TOL_DEG } = {}) {
  if (!pending?.length) return [];
  const traces = (shapes ?? []).filter((s) => s.pointsAreTrace).map((s) => s.points);
  const out = [];
  for (const { line, pattern: p } of pending) {
    const snapped = snapToNetwork(p.stops, traces);
    if (!snapped) continue;
    const points = simplifyLine(snapped, tolDeg);
    if (!isRealTrace(points, p.stops.length)) continue;
    out.push(shapeOf(line, p, points));
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ fetchFn?: Function, now?: () => number, pauseMs?: number, timeoutMs?: number,
 *   tolDeg?: number }} [opts]
 */
export function createRailNetworkService({
  fetchFn = (...a) => fetch(...a),
  now = () => Date.now(),
  pauseMs = PAUSE_MS,
  timeoutMs = TIMEOUT_MS,
  tolDeg = NATIONAL_RAIL_TOL_DEG,
} = {}) {
  const perLine = new Map(); // line id -> { at, shapes, unsnapped }
  let current = Object.freeze([]);
  let currentHash = hashString('[]');
  let currentBytes = 2;
  let inFlight = null;
  let jpCalls = 0;

  const query = async (q, variables) => {
    jpCalls++;
    try {
      return await jpQuery(q, fetchFn, timeoutMs, variables);
    } finally {
      // Pause også etter feil, så en 429 ikke blir mange kall i rask rekkefølge
      if (pauseMs) await sleep(pauseMs);
    }
  };

  async function fetchLine(line) {
    const data = await query(PATTERNS_QUERY, { id: line.id });
    const chosen = choosePatterns(data?.line?.journeyPatterns);
    if (chosen.length === 0) return { shapes: [], unsnapped: [] };
    const ids = chosen.map((c) => c.id);
    const q = `query { ${ids.map((id, k) => `p${k}: serviceJourney(id: ${JSON.stringify(id)}) { journeyPattern { pointsOnLink { points } } }`).join(' ')} }`;
    const pts = await query(q);
    const encById = new Map();
    ids.forEach((id, k) => {
      const enc = pts?.[`p${k}`]?.journeyPattern?.pointsOnLink?.points;
      if (typeof enc === 'string' && enc) encById.set(id, enc);
    });
    return buildRailShapes(line, chosen, encById, { tolDeg });
  }

  function rebuild(lines) {
    const all = [];
    const pending = [];
    for (const line of lines) {
      const c = perLine.get(line.id);
      if (!c) continue;
      all.push(...c.shapes);
      for (const pattern of c.unsnapped) pending.push({ line, pattern });
    }
    all.push(...snapUnsnapped(pending, all, { tolDeg }));
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
    let lines;
    try {
      lines = pickRailLines((await query(LINES_QUERY))?.lines);
    } catch (e) {
      console.warn('[RuterLive] Togruter (hele landet), linjeliste:', e.message);
      return { shapes: current, failed: 1 };
    }
    if (lines.length === 0) return { shapes: current, failed: 1 };
    let failed = 0;
    for (const line of lines) {
      const c = perLine.get(line.id);
      if (c && now() - c.at < maxAgeMs) continue;
      try {
        perLine.set(line.id, { at: now(), ...(await fetchLine(line)) });
      } catch (e) {
        failed++;
        console.warn(`[RuterLive] Togrute ${line.code}:`, e.message);
        if (/JP 429/.test(e.message)) break; // rate limit: resten hentes ved neste forsøk
      }
    }
    // Linjer som ikke lenger finnes i JP faller ut
    if (failed === 0) for (const id of [...perLine.keys()]) if (!lines.some((l) => l.id === id)) perLine.delete(id);
    const shapes = rebuild(lines);
    console.log(`[RuterLive] Togruter fra JP (hele landet): ${shapes.length} ruter for ${lines.length} linjer, ${failed} feil (JP-kall totalt: ${jpCalls})`);
    return { shapes, failed };
  }

  return {
    /** Henter linjer som mangler eller er eldre enn `maxAgeMs`. Samtidige kall deler samme henting. */
    refresh({ maxAgeMs = DAY_MS - 60 * 60 * 1000 } = {}) {
      if (!inFlight) inFlight = runRefresh(maxAgeMs).finally(() => { inFlight = null; });
      return inFlight;
    },
    /** Samme array så lenge innholdet er uendret (stabil shapesVersion). */
    getShapes: () => current,
    stats: () => ({ lines: perLine.size, shapes: current.length, bytes: currentBytes, jpCalls }),
  };
}
