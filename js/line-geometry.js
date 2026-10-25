/**
 * Flytter ET-kjøretøy langs faktisk trasé (gate/spor) i stedet for rett linje mellom holdeplassene.
 *
 * Rutekartene med `pointsAreTrace` (fra /api/route-shapes-all) gjøres om til en polyline med
 * kumulative avstander, lat per linje først når den trengs. Holdeplassene i kjøretøyets path
 * projiseres på linjen (nærmeste punkt, i kjørerekkefølge), og posisjonen er andelen `fraction`
 * av avstanden langs linjen mellom de to projeksjonene. Gir null når holdeplassene ikke ligger
 * fornuftig på linjen, så kalleren bruker den rette posisjonen.
 *
 * Ekstra CPU bare for kjøretøy innenfor kartutsnittet (med margin) og ved zoom >= 13.
 * Ingen Leaflet-avhengighet: kalleren (js/markers.js) gir zoom og utsnitt per tikk.
 */

import { isFlytogLineCode } from '../config.js';

export const MIN_ZOOM = 13;
/** Maks avstand fra holdeplass til linjen før projeksjonen forkastes. */
export const MAX_OFF_LINE_M = 150;
/** Strekningen langs linjen kan ikke være mye lengre enn luftlinjen (feil retning, sløyfe). */
const MAX_DETOUR_RATIO = 3;
const MAX_DETOUR_EXTRA_M = 300;
const M_PER_DEG = 111320;

const valid = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Klargjør et rutekart: lokale meter-koordinater og kumulativ avstand. Null ved for få punkter. */
export function prepareLine(points) {
  const pts = (points ?? []).filter(valid);
  if (pts.length < 2) return null;
  const n = pts.length;
  const k = Math.cos((pts[0][0] * Math.PI) / 180);
  const lat = new Float64Array(n), lon = new Float64Array(n);
  const x = new Float64Array(n), y = new Float64Array(n), cum = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = pts[i][0];
    lon[i] = pts[i][1];
    x[i] = lon[i] * k * M_PER_DEG;
    y[i] = lat[i] * M_PER_DEG;
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  }
  return { n, k, lat, lon, x, y, cum, length: cum[n - 1], pairs: new Map() };
}

/**
 * Nærmeste punkt på linjen for [lat, lon], begrenset til avstand langs linjen i [minS, maxS].
 * @returns {{ s: number, d: number }} s = meter langs linjen, d = avstand fra linjen i meter
 */
export function projectPoint(P, pt, minS = 0, maxS = Infinity) {
  const px = pt[1] * P.k * M_PER_DEG, py = pt[0] * M_PER_DEG;
  let best = { s: NaN, d: Infinity };
  for (let i = 0; i < P.n - 1; i++) {
    const s0 = P.cum[i], s1 = P.cum[i + 1];
    if (s1 < minS || s0 > maxS) continue;
    const len = s1 - s0;
    const dx = P.x[i + 1] - P.x[i], dy = P.y[i + 1] - P.y[i];
    let t = len === 0 ? 0 : ((px - P.x[i]) * dx + (py - P.y[i]) * dy) / (len * len);
    const tMin = len === 0 ? 0 : Math.max(0, (minS - s0) / len);
    const tMax = len === 0 ? 0 : Math.min(1, (maxS - s0) / len);
    t = Math.max(tMin, Math.min(tMax, t));
    const d = Math.hypot(P.x[i] + t * dx - px, P.y[i] + t * dy - py);
    if (d < best.d) best = { s: s0 + t * len, d };
  }
  return best;
}

/** Punktet [lat, lon] `s` meter langs linjen. */
export function pointAt(P, s) {
  if (s <= 0) return [P.lat[0], P.lon[0]];
  if (s >= P.length) return [P.lat[P.n - 1], P.lon[P.n - 1]];
  let lo = 0, hi = P.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (P.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const len = P.cum[hi] - P.cum[lo];
  const t = len === 0 ? 0 : (s - P.cum[lo]) / len;
  return [P.lat[lo] + t * (P.lat[hi] - P.lat[lo]), P.lon[lo] + t * (P.lon[hi] - P.lon[lo])];
}

function airM(P, a, b) {
  return Math.hypot((b[1] - a[1]) * P.k * M_PER_DEG, (b[0] - a[0]) * M_PER_DEG);
}

/**
 * Projeksjon av holdeplassparet (fra → til) i kjørerekkefølge, cachet per par.
 * Prøver først «fra» nærmest overalt og «til» etter den, deretter omvendt (sløyfer).
 * @returns {{ sA: number, sB: number } | null}
 */
const pairKey = (a, b) => `${a[0]},${a[1]}|${b[0]},${b[1]}`;

export function projectPair(P, a, b) {
  const key = pairKey(a, b);
  if (P.pairs.has(key)) return P.pairs.get(key);
  let result = null;
  if (a[0] !== b[0] || a[1] !== b[1]) {
    const air = airM(P, a, b);
    const ok = (pa, pb) => pa.d <= MAX_OFF_LINE_M && pb.d <= MAX_OFF_LINE_M && pb.s > pa.s
      && pb.s - pa.s <= air * MAX_DETOUR_RATIO + MAX_DETOUR_EXTRA_M;
    const a1 = projectPoint(P, a);
    const b1 = projectPoint(P, b, a1.s);
    if (ok(a1, b1)) result = { sA: a1.s, sB: b1.s };
    else {
      const b2 = projectPoint(P, b);
      const a2 = projectPoint(P, a, 0, b2.s);
      if (ok(a2, b2)) result = { sA: a2.s, sB: b2.s };
    }
  }
  P.pairs.set(key, result);
  return result;
}

// --- Rutekart og kjøretøy ---------------------------------------------------------------

let shapesRef = null;
let byLine = new Map(); // "mode|LINJE" -> trasé-rutekart
let byKey = new Map(); // "mode|line|from|to" -> rutekart
const prepared = new WeakMap(); // rutekart -> P | null
let vehiclesById = new Map();
const lookups = new Map(); // vehicleId -> { key, cands, a, b, hit }
/** Maks nye holdeplasspar-projeksjoner per tikk (kald start med mange kjøretøy i bildet). */
const NEW_PAIRS_PER_TICK = 80;
let budgetSec = -1;
let budgetLeft = 0;

const normLine = (s) => String(s ?? '').toUpperCase().replace(/^0+(?=.)/, '');
const shapeKey = (s) => `${(s.mode || '').toLowerCase()}|${s.line ?? ''}|${s.from || ''}|${s.to || ''}`;

/** Samme modusregler som js/routes.js (flytog, flybuss). */
export function vehicleMode(v) {
  const m = (v?.mode || '').toLowerCase();
  const code = (v?.line?.publicCode || '').toUpperCase();
  if (m === 'rail' && isFlytogLineCode(code)) return 'flytog';
  if ((m === 'bus' || m === 'coach') && code.startsWith('FB')) return 'flybuss';
  return m || 'bus';
}

/** Samme idé som destMatchesNorm i js/routes.js. */
function destMatches(dest, to) {
  const d = (dest || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const t = (to || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!d || !t) return false;
  return d.includes(t) || t.includes(d);
}

function preparedFor(shape) {
  if (!prepared.has(shape)) prepared.set(shape, prepareLine(shape.points));
  return prepared.get(shape);
}

/** Rutekart (fra route-shapes-all) og kjøretøy. Billig når rutekartene er de samme som sist. */
export function setLineGeometryData(shapes, vehicles) {
  if (shapes !== shapesRef) {
    shapesRef = shapes;
    byLine = new Map();
    byKey = new Map();
    for (const s of shapes ?? []) {
      if (!s?.pointsAreTrace || !Array.isArray(s.points) || s.points.length < 2) continue;
      const k = `${(s.mode || '').toLowerCase()}|${normLine(s.line)}`;
      if (!byLine.has(k)) byLine.set(k, []);
      byLine.get(k).push(s);
      byKey.set(shapeKey(s), s);
    }
    lookups.clear();
  }
  if (vehicles) {
    vehiclesById = new Map();
    for (const v of vehicles) if (v?.vehicleId != null) vehiclesById.set(v.vehicleId, v);
    for (const id of lookups.keys()) if (!vehiclesById.has(id)) lookups.delete(id);
  }
}

/** Trasé-rutekart for kjøretøyet: de som går mot destinasjonen først. */
function candidatesFor(v) {
  const list = byLine.get(`${vehicleMode(v)}|${normLine(v?.line?.publicCode)}`);
  if (!list) return [];
  const dest = v?.destinationName;
  return [...list.filter((s) => destMatches(dest, s.to)), ...list.filter((s) => !destMatches(dest, s.to))];
}

function resolveShapes(shapeKeyOrLookup) {
  if (typeof shapeKeyOrLookup === 'string') {
    const s = byKey.get(shapeKeyOrLookup);
    return s ? [s] : [];
  }
  if (Array.isArray(shapeKeyOrLookup)) return shapeKeyOrLookup;
  if (shapeKeyOrLookup && typeof shapeKeyOrLookup === 'object') {
    if (Array.isArray(shapeKeyOrLookup.points)) return [shapeKeyOrLookup];
    return candidatesFor(shapeKeyOrLookup);
  }
  return [];
}

/**
 * Posisjon `fraction` (0–1) av veien langs linjen fra `stopFrom` til `stopTo`, eller null.
 * @param {string | object | object[]} shapeKeyOrLookup rutekartnøkkel (mode|line|from|to), et
 *   rutekart, en liste rutekart eller et kjøretøy-lignende oppslag { mode, line: { publicCode }, destinationName }
 */
export function projectOnLine(shapeKeyOrLookup, stopFromLatLon, stopToLatLon, fraction) {
  if (!valid(stopFromLatLon) || !valid(stopToLatLon) || !Number.isFinite(fraction)) return null;
  const f = Math.max(0, Math.min(1, fraction));
  for (const shape of resolveShapes(shapeKeyOrLookup)) {
    const P = preparedFor(shape);
    const r = P && projectPair(P, stopFromLatLon, stopToLatLon);
    if (r) return pointAt(P, r.sA + f * (r.sB - r.sA));
  }
  return null;
}

/**
 * Gjeldende strekning i en ms-path ([lat, lon, arrMs, depMs]), samme regler som positionAt i
 * shared/vehicle-path.js. Venter på holdeplass: andel 0 mot neste (eller 1 fra forrige ved siste).
 * @returns {{ a: number[], b: number[], f: number } | null}
 */
export function pathSegmentAt(path, nowMs) {
  if (!Array.isArray(path) || path.length < 2 || !Number.isFinite(nowMs)) return null;
  const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const last = path.length - 1;
  const at = (i) => (i < last ? { a: path[i], b: path[i + 1], f: 0 } : { a: path[last - 1], b: path[last], f: 1 });
  let prevDep = null;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    let arr = num(p[2]) ?? num(p[3]);
    let dep = num(p[3]) ?? arr;
    if (prevDep !== null) {
      if (arr === null || arr < prevDep) arr = prevDep;
      if (dep === null || dep < arr) dep = arr;
    }
    if (i > 0 && nowMs < arr) {
      const span = arr - prevDep;
      const f = span > 0 ? Math.max(0, Math.min(1, (nowMs - prevDep) / span)) : 1;
      return { a: path[i - 1], b: p, f };
    }
    if (dep === null || nowMs <= dep) return at(i);
    prevDep = dep;
  }
  return at(last);
}

/**
 * Posisjon på traseen for et ET-kjøretøy, eller null (bruk `straightPos`).
 * Bare ved zoom >= 13 og når den rette posisjonen er innenfor utsnittet.
 * Oppslaget (rutekart-kandidater og siste holdeplasspar) caches per kjøretøy.
 * @param {{ zoom: number, s: number, n: number, w: number, e: number }} vw zoom og utsnitt (med margin)
 */
export function onLinePosition(vehicleId, path, nowMs, straightPos, vw) {
  if (!straightPos || !vw || byLine.size === 0) return null;
  if (!(vw.zoom >= MIN_ZOOM)) return null;
  if (straightPos[0] < vw.s || straightPos[0] > vw.n || straightPos[1] < vw.w || straightPos[1] > vw.e) return null;
  const v = vehiclesById.get(vehicleId);
  if (!v) return null;
  const key = `${vehicleMode(v)}|${normLine(v.line?.publicCode)}|${v.destinationName || ''}`;
  let L = lookups.get(vehicleId);
  if (!L || L.key !== key) {
    L = { key, cands: candidatesFor(v), a: null, b: null, hit: null };
    lookups.set(vehicleId, L);
  }
  if (L.cands.length === 0) return null;
  const seg = pathSegmentAt(path, nowMs);
  if (!seg) return null;
  // Samme holdeplasspar som forrige tikk (path-elementene er de samme objektene til neste polling)
  if (seg.a !== L.a || seg.b !== L.b) {
    const sec = Math.floor(nowMs / 1000);
    if (sec !== budgetSec) {
      budgetSec = sec;
      budgetLeft = NEW_PAIRS_PER_TICK;
    }
    const pk = pairKey(seg.a, seg.b);
    let hit = null;
    for (const shape of L.cands) {
      const P = preparedFor(shape);
      if (!P) continue;
      // Nye par koster O(punkter); fordeles over tikkene, resten går rett til neste tikk
      if (!P.pairs.has(pk)) {
        if (budgetLeft <= 0) return null;
        budgetLeft--;
      }
      const r = projectPair(P, seg.a, seg.b);
      if (r) { hit = { P, r }; break; }
    }
    L.a = seg.a;
    L.b = seg.b;
    L.hit = hit;
  }
  if (!L.hit) return null;
  const { P, r } = L.hit;
  return pointAt(P, r.sA + seg.f * (r.sB - r.sA));
}

/** Fjerner rutekart for linjer som har fått trasé i `fresh` (gamle rette streker blir ellers liggende). */
export function withoutTracedLines(existing, fresh) {
  const traced = new Set();
  for (const s of fresh ?? []) if (s?.pointsAreTrace) traced.add(`${(s.mode || '').toLowerCase()}|${normLine(s.line)}`);
  if (traced.size === 0) return existing ?? [];
  return (existing ?? []).filter((s) => !traced.has(`${(s.mode || '').toLowerCase()}|${normLine(s.line)}`));
}
