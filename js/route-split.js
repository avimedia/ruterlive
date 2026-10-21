/**
 * Deler en rute i kjørt og gjenstående del ved nærmeste punkt til kjøretøyet.
 * Ren geometri, ingen avhengigheter. Punkter er [lat, lon], ordnet fra start til mål.
 */

const valid = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]);

export function splitRouteAt(latlngs, point) {
  const pts = Array.isArray(latlngs) ? latlngs : [];
  if (pts.length === 0) return { driven: [], ahead: [] };
  if (pts.length === 1) return { driven: [pts[0]], ahead: [] };
  if (!valid(point)) return { driven: [], ahead: pts };

  // Lokal flate: skaler lon med cos(lat) så avstander blir noenlunde like i x og y
  const k = Math.cos((point[0] * Math.PI) / 180);
  let best = { d2: Infinity, i: 0, t: 0 };
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][1] * k, ay = pts[i][0];
    const bx = pts[i + 1][1] * k, by = pts[i + 1][0];
    const px = point[1] * k, py = point[0];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const ex = ax + t * dx - px, ey = ay + t * dy - py;
    const d2 = ex * ex + ey * ey;
    if (d2 < best.d2) best = { d2, i, t };
  }
  const a = pts[best.i], b = pts[best.i + 1];
  const proj = best.t === 0 ? [a[0], a[1]] : best.t === 1 ? [b[0], b[1]]
    : [a[0] + best.t * (b[0] - a[0]), a[1] + best.t * (b[1] - a[1])];
  return {
    driven: [...pts.slice(0, best.i + 1), proj].filter((p, j, arr) => j === 0 || p[0] !== arr[j - 1][0] || p[1] !== arr[j - 1][1]),
    ahead: [proj, ...pts.slice(best.i + 1)].filter((p, j, arr) => j === 0 || p[0] !== arr[j - 1][0] || p[1] !== arr[j - 1][1]),
  };
}
