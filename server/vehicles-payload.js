/**
 * Kompakt JSON for /api/vehicles-live: bare feltene klienten bruker, koordinater på 5 desimaler
 * (~1 m), tomme felt utelatt og ET-path med tider i sekunder relativt til `t0`.
 */

import { encodeVehiclePath } from '../shared/vehicle-path.js';
import { roundDelay } from '../shared/vehicle-delay.js';

const round5 = (x) => Math.round(x * 1e5) / 1e5;
const TEXT_FIELDS = ['destinationName', 'from', 'to', 'nextStop', 'via'];

function compactVehicle(v, t0) {
  const out = { vehicleId: v.vehicleId };
  if (v.mode) out.mode = v.mode;
  const lat = v.location?.latitude;
  const lon = v.location?.longitude;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    out.location = { latitude: round5(lat), longitude: round5(lon) };
  }
  if (v.line?.publicCode != null) {
    out.line = { publicCode: v.line.publicCode };
    // JP-linje-ID (f.eks. RUT:Line:30) så klienten kan hente hel rute via /api/vehicle-route
    if (typeof v.line.lineRef === 'string' && v.line.lineRef) out.line.ref = v.line.lineRef;
  }
  for (const k of TEXT_FIELDS) if (v[k]) out[k] = v[k];
  if (Number.isFinite(v.bearing)) out.bearing = Math.round(v.bearing);
  if (Array.isArray(v.path) && v.path.length >= 2) out.path = encodeVehiclePath(v.path, t0);
  // Forsinkelse i sekunder, avrundet til 30 s; utelatt under ett minutt
  const delay = roundDelay(v.delay);
  if (delay !== null) out.delay = delay;
  return out;
}

/**
 * @param {object[]} vehicles sammenslåtte kjøretøy (GPS + ET), path i ms-format
 * @param {{ shapesVersion?: string|null, nowMs?: number }} opts
 * @returns {{ t0: number, shapesVersion: string|null, vehicles: object[] }}
 */
export function buildVehiclesPayload(vehicles, { shapesVersion = null, nowMs = Date.now() } = {}) {
  const t0 = Math.floor(nowMs / 1000);
  const out = [];
  for (const v of vehicles ?? []) {
    if (v?.vehicleId) out.push(compactVehicle(v, t0));
  }
  return { t0, shapesVersion, vehicles: out };
}
