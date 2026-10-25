/**
 * Posisjon langs en kort rute av holdeplasser, beregnet fra rutetider.
 * Brukes av klienten for å flytte ET-kjøretøy jevnt mellom pollingene.
 * Ren funksjon, ingen avhengigheter.
 *
 * To formater:
 * - ms (internt på serveren): [[lat, lon, arrMs, depMs], ...], epoch ms.
 * - kompakt (/api/vehicles-live): [[lat, lon, arrSek, depSek] | [lat, lon, sek], ...],
 *   sekunder relativt til svarets `t0` (epoch-sekunder). Tre elementer = ankomst lik avgang.
 *
 * positionAt(path, nowMs, t0): med t0 tolkes tidene som kompakte, uten t0 som epoch ms.
 * - før første avgang: på første punkt
 * - mellom ankomst og avgang: venter på holdeplassen
 * - mellom avgang(i) og ankomst(i+1): lineært
 * - etter siste ankomst: på siste punkt
 */

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** ms-path → kompakt path relativt til t0 (epoch-sekunder). */
export function encodeVehiclePath(path, t0) {
  if (!Array.isArray(path) || !Number.isFinite(t0)) return null;
  const rel = (ms) => (num(ms) === null ? null : Math.round(ms / 1000) - t0);
  return path.map((p) => {
    const arr = rel(p[2]);
    const dep = rel(p[3]);
    return arr === dep || dep === null ? [p[0], p[1], arr] : [p[0], p[1], arr, dep];
  });
}

/** Kompakt path → ms-path ([lat, lon, arrMs, depMs]). */
export function decodeVehiclePath(path, t0) {
  if (!Array.isArray(path) || !Number.isFinite(t0)) return null;
  const abs = (s) => (num(s) === null ? null : (t0 + s) * 1000);
  return path.map((p) => {
    const arr = abs(p?.[2]);
    const dep = p?.length > 3 ? abs(p[3]) : arr;
    return [p?.[0], p?.[1], arr, dep];
  });
}

export function positionAt(path, nowMs, t0) {
  if (!Array.isArray(path) || path.length === 0 || !Number.isFinite(nowMs)) return null;
  // Kompakt format: regn i sekunder relativt til t0 (interpolering er skala-uavhengig)
  if (Number.isFinite(t0)) nowMs = nowMs / 1000 - t0;
  for (const p of path) {
    if (!Array.isArray(p) || num(p[0]) === null || num(p[1]) === null) return null;
  }

  let prevDep = null;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    let arr = num(p[2]) ?? num(p[3]);
    let dep = num(p[3]) ?? arr;
    // Tider som går bakover (forsinkelse i forrige stopp) behandles som «ingen kjøretid»
    if (prevDep !== null) {
      if (arr === null || arr < prevDep) arr = prevDep;
      if (dep === null || dep < arr) dep = arr;
    }
    if (i > 0 && nowMs < arr) {
      const a = path[i - 1];
      const span = arr - prevDep;
      const t = span > 0 ? Math.max(0, Math.min(1, (nowMs - prevDep) / span)) : 1;
      return [a[0] + t * (p[0] - a[0]), a[1] + t * (p[1] - a[1])];
    }
    if (dep === null || nowMs <= dep) return [p[0], p[1]];
    prevDep = dep;
  }
  const last = path[path.length - 1];
  return [last[0], last[1]];
}

/**
 * Står kjøretøyet på en holdeplass ifølge rutetidene? Samme regler og tidsformat som positionAt:
 * true før første avgang, mellom ankomst og avgang og etter siste ankomst; false under kjøring.
 */
export function isDwelling(path, nowMs, t0) {
  if (!Array.isArray(path) || path.length === 0 || !Number.isFinite(nowMs)) return false;
  if (Number.isFinite(t0)) nowMs = nowMs / 1000 - t0;
  let prevDep = null;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (!Array.isArray(p)) return false;
    let arr = num(p[2]) ?? num(p[3]);
    let dep = num(p[3]) ?? arr;
    if (prevDep !== null) {
      if (arr === null || arr < prevDep) arr = prevDep;
      if (dep === null || dep < arr) dep = arr;
    }
    if (i > 0 && nowMs < arr) return false; // underveis mellom to stopp
    if (dep === null || nowMs <= dep) return true;
    prevDep = dep;
  }
  return true;
}

const round5 = (x) => Math.round(x * 1e5) / 1e5;

/**
 * Bygger en kompakt path fra ET-kall: siste passerte kall + opptil `ahead` neste.
 * recordedCalls: [{ quayId, time }] (time = avgang), estimatedCalls: [{ quayId, arrTime, depTime }].
 * getCoords(quayId) -> [lat, lon] | undefined. Stopper ved første kall uten koordinater
 * eller ved urimelig langt sprang (maxHopKm). Gir null hvis færre enn to punkter.
 */
export function buildVehiclePath(recordedCalls, estimatedCalls, getCoords, { ahead = 3, maxHopKm = Infinity } = {}) {
  const rec = Array.isArray(recordedCalls) ? recordedCalls : [];
  const est = Array.isArray(estimatedCalls) ? estimatedCalls : [];
  const calls = [];
  const last = rec[rec.length - 1];
  if (last) calls.push({ quayId: last.quayId, arr: last.time, dep: last.time });
  for (const c of est) {
    if (calls.length >= ahead + 1) break;
    calls.push({ quayId: c.quayId, arr: c.arrTime ?? c.depTime, dep: c.depTime ?? c.arrTime });
  }
  const path = [];
  for (const c of calls) {
    const xy = c.quayId ? getCoords(c.quayId) : null;
    if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) break;
    if (!Number.isFinite(c.arr) && !Number.isFinite(c.dep)) break;
    const prev = path[path.length - 1];
    if (prev && hopKm(prev, xy) > maxHopKm) break;
    path.push([round5(xy[0]), round5(xy[1]), Number.isFinite(c.arr) ? c.arr : c.dep, Number.isFinite(c.dep) ? c.dep : c.arr]);
  }
  return path.length >= 2 ? path : null;
}

function hopKm(a, b) {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
