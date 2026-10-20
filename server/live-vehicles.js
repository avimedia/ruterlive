/**
 * Slår sammen kjøretøy fra Entur GraphQL og SIRI ET, samt rutekart.
 * Delt av /api/initial-data og linjesidene.
 */

import { getCachedVehicles } from './vehicles-cache.js';
import { getEtVehiclesAndShapes } from './et-vehicles-service.js';

function shapeKey(s) {
  return `${(s.mode || '').toLowerCase()}|${(s.line || '').toString()}|${s.from || ''}|${s.to || ''}`;
}

export function mergeShapes(a, b) {
  const byKey = new Map();
  for (const s of a || []) byKey.set(shapeKey(s), s);
  for (const s of b || []) {
    const k = shapeKey(s);
    const ex = byKey.get(k);
    const ptsNew = s.points?.length ?? 0;
    const ptsOld = ex?.points?.length ?? 0;
    if (!ex || ptsNew >= ptsOld) byKey.set(k, s);
  }
  return [...byKey.values()];
}

/**
 * @param {() => object[]} [getAllShapes] statiske rutekart (eies av server.js)
 * @returns {Promise<{ vehicles: object[], routeShapes: object[] }>}
 */
export async function getLiveData(getAllShapes = () => []) {
  const [vehiclesData, etResult, shapes] = await Promise.all([
    getCachedVehicles(),
    getEtVehiclesAndShapes(),
    Promise.resolve(getAllShapes()),
  ]);
  const graphqlVehicles = Array.isArray(vehiclesData?.data?.vehicles)
    ? vehiclesData.data.vehicles
    : [];
  const etVehicles = etResult?.vehicles ?? [];
  const etShapes = etResult?.shapes ?? [];

  const etByid = new Map(etVehicles.map((v) => [v.vehicleId, v]));
  const merged = [];
  for (const v of graphqlVehicles) {
    const et = etByid.get(v.vehicleId);
    merged.push(
      et
        ? { ...v, from: v.from ?? et.from, to: v.to ?? et.to, via: v.via ?? et.via }
        : v
    );
  }
  const seen = new Set(graphqlVehicles.map((v) => v.vehicleId));
  for (const v of etVehicles) {
    if (!seen.has(v.vehicleId)) merged.push(v);
  }

  return { vehicles: merged, routeShapes: mergeShapes(shapes, etShapes) };
}

export async function getMergedVehicles() {
  return (await getLiveData()).vehicles;
}

/** Teller kjøretøy som kjører linjen, inkl. x-varianter (aliaser). */
export function countVehiclesForLine(vehicles, line) {
  const codes = new Set([line.code, ...(line.aliases ?? [])].map((c) => c.toUpperCase()));
  let n = 0;
  for (const v of vehicles ?? []) {
    const code = v?.line?.publicCode;
    if (code && codes.has(String(code).toUpperCase())) n++;
  }
  return n;
}
