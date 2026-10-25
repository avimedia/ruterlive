/**
 * Deler en rute i kjørt og gjenstående del ved nærmeste punkt til kjøretøyet,
 * og velger nærmeste rute når flere passer. Ren geometri, ingen avhengigheter.
 * Punkter er [lat, lon], ordnet fra start til mål.
 */

const valid = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);
const M_PER_DEG = 111320;

/** Nærmeste punkt på ruten: segment i, andel t langs segmentet og kvadrert avstand (grader). */
function nearestOnRoute(pts, point) {
  // Lokal flate: skaler lon med cos(lat) så avstander blir noenlunde like i x og y
  const k = Math.cos((point[0] * Math.PI) / 180);
  const px = point[1] * k, py = point[0];
  let best = { d2: Infinity, i: 0, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][1] * k, ay = pts[i][0];
    const bx = pts[i + 1][1] * k, by = pts[i + 1][0];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    const d2 = ex * ex + ey * ey;
    if (d2 < best.d2) best = { d2, i, t };
  }
  return best;
}

export function splitRouteAt(latlngs, point) {
  const pts = Array.isArray(latlngs) ? latlngs : [];
  if (pts.length === 0) return { driven: [], ahead: [] };
  if (pts.length === 1) return { driven: [pts[0]], ahead: [] };
  if (!valid(point)) return { driven: [], ahead: pts };

  const best = nearestOnRoute(pts, point);
  const a = pts[best.i], b = pts[best.i + 1];
  const proj = best.t === 0 ? [a[0], a[1]] : best.t === 1 ? [b[0], b[1]]
    : [a[0] + best.t * (b[0] - a[0]), a[1] + best.t * (b[1] - a[1])];
  return {
    driven: [...pts.slice(0, best.i + 1), proj].filter((p, j, arr) => j === 0 || p[0] !== arr[j - 1][0] || p[1] !== arr[j - 1][1]),
    ahead: [proj, ...pts.slice(best.i + 1)].filter((p, j, arr) => j === 0 || p[0] !== arr[j - 1][0] || p[1] !== arr[j - 1][1]),
  };
}

/** Punkter som [lat, lon] (godtar også { lat, lon }); ugyldige punkter droppes. */
export function toLatLngs(points) {
  if (!Array.isArray(points)) return [];
  return points
    .map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : p && typeof p === 'object' ? [Number(p.lat), Number(p.lon)] : null))
    .filter(valid);
}

/** Avstand i meter fra punktet til nærmeste sted på ruten (Infinity uten rute). */
export function distanceToRouteM(latlngs, point) {
  const pts = Array.isArray(latlngs) ? latlngs : [];
  if (!valid(point) || pts.length === 0) return Infinity;
  if (pts.length === 1) {
    const k = Math.cos((point[0] * Math.PI) / 180);
    return Math.hypot((pts[0][1] - point[1]) * k, pts[0][0] - point[0]) * M_PER_DEG;
  }
  return Math.sqrt(nearestOnRoute(pts, point).d2) * M_PER_DEG;
}

/** Rutens lengde i meter. */
export function routeLengthM(latlngs) {
  const pts = Array.isArray(latlngs) ? latlngs : [];
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    const k = Math.cos((pts[i][0] * Math.PI) / 180);
    sum += Math.hypot((pts[i][1] - pts[i - 1][1]) * k, pts[i][0] - pts[i - 1][0]);
  }
  return sum * M_PER_DEG;
}

/**
 * Velger én rute for valgt kjøretøy blant flere som passer: den nærmeste kjøretøyets posisjon.
 * Ruter innenfor tieM meter av den nærmeste regnes som like nære (felles strekning); da vinner den lengste.
 * @param {Array<{ points?: Array }>} shapes
 * @param {[number, number] | null} point [lat, lon]
 * @returns {number} indeks i shapes, -1 når listen er tom
 */
export function chooseClosestShape(shapes, point, { tieM = 25 } = {}) {
  if (!Array.isArray(shapes) || shapes.length === 0) return -1;
  const info = shapes.map((s) => {
    const pts = toLatLngs(s?.points);
    return { dist: distanceToRouteM(pts, point), len: routeLengthM(pts) };
  });
  const minDist = Math.min(...info.map((x) => x.dist));
  let best = -1;
  for (let i = 0; i < info.length; i++) {
    const near = minDist === Infinity || info[i].dist <= minDist + tieM;
    if (!near) continue;
    if (best === -1 || info[i].len > info[best].len) best = i;
  }
  return best;
}
