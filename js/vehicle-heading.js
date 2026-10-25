/**
 * Kjøreretning for kjøretøymarkører. Rene funksjoner (testes i test/vehicle-heading.test.js).
 */

const RAD = Math.PI / 180;
const EARTH_M = 6371000;

/** Avstand i meter mellom [lat, lon]-punkter (ekvirektangulær tilnærming, god nok for korte avstander). */
export function distanceM(a, b) {
  const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD);
  const y = (b[0] - a[0]) * RAD;
  return Math.sqrt(x * x + y * y) * EARTH_M;
}

/** Kurs i grader (0 = nord, 90 = øst) fra a til b, heltall 0–359. */
export function bearingDeg(a, b) {
  const x = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * RAD);
  const y = b[0] - a[0];
  const deg = Math.round(Math.atan2(x, y) / RAD);
  return ((deg % 360) + 360) % 360;
}

/** Minste vinkel mellom to kurser (0–180). */
export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Minste flytting før ny kurs regnes ut fra to viste posisjoner. */
export const MIN_HEADING_MOVE_M = 3;
/** Pila roteres bare når kursen endres minst så mye. */
export const MIN_HEADING_CHANGE_DEG = 5;

/**
 * Ny kurs fra forrige og nåværende viste posisjon, eller null når kjøretøyet har flyttet seg for lite.
 * Ved null beholdes både forrige posisjon og kurs.
 */
export function headingFromMove(prev, cur, minMoveM = MIN_HEADING_MOVE_M) {
  if (!prev || !cur) return null;
  if (distanceM(prev, cur) < minMoveM) return null;
  return bearingDeg(prev, cur);
}
