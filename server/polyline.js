/**
 * Google polyline (Journey Planner pointsOnLink.points) og forenkling av linjer.
 */

/** Dekoder Google polyline til [[lat, lon], ...] */
export function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return [];
  const values = [];
  let current = 0;
  let bits = 0;
  for (let i = 0; i < encoded.length; i++) {
    const byte = encoded.charCodeAt(i) - 63;
    current |= (byte & 0x1f) << bits;
    bits += 5;
    if (byte < 0x20) {
      values.push(current & 1 ? ~(current >>> 1) : current >>> 1); // fortegnet ligger i bit 0 av hele verdien
      current = 0;
      bits = 0;
    }
  }
  const points = [];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i + 1 < values.length; i += 2) {
    lat += values[i] / 1e5;
    lon += values[i + 1] / 1e5;
    points.push([lat, lon]);
  }
  return points;
}

/**
 * Douglas-Peucker på [lat, lon] med lon skalert med cos(lat). `tolDeg` er maks avvik i grader
 * breddegrad (1e-5 ≈ 1,1 m). Iterativ, så lange linjer ikke sprenger stakken.
 */
export function simplifyLine(points, tolDeg = 2e-5) {
  const pts = Array.isArray(points) ? points : [];
  if (pts.length <= 2) return pts.slice();
  const k = Math.cos((pts[0][0] * Math.PI) / 180);
  const tol2 = tolDeg * tolDeg;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][1] * k, ay = pts[a][0];
    const dx = pts[b][1] * k - ax, dy = pts[b][0] - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i][1] * k - ax, py = pts[i][0] - ay;
      let t = len2 === 0 ? 0 : (px * dx + py * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const ex = px - t * dx, ey = py - t * dy;
      const d = ex * ex + ey * ey;
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (idx > -1 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
