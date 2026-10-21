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
 * GPS-kjøretøy (GraphQL) beriket med fra/til/via fra ET, pluss ET-kjøretøy uten GPS.
 * @param {object} vehiclesData svar fra getCachedVehicles
 * @param {{ vehicles?: object[] }} etResult svar fra getEtVehiclesAndShapes
 */
export function mergeVehicles(vehiclesData, etResult) {
  const graphqlVehicles = Array.isArray(vehiclesData?.data?.vehicles)
    ? vehiclesData.data.vehicles
    : [];
  const etVehicles = etResult?.vehicles ?? [];

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
  return merged;
}

/**
 * @param {() => object[]} [getAllShapes] statiske rutekart (eies av server.js)
 * @returns {Promise<{ vehicles: object[], routeShapes: object[] }>}
 */
export async function getLiveData(getAllShapes = () => []) {
  const [vehiclesData, etResult] = await Promise.all([
    getCachedVehicles(),
    getEtVehiclesAndShapes(),
  ]);
  return {
    vehicles: mergeVehicles(vehiclesData, etResult),
    routeShapes: mergeShapes(getAllShapes(), etResult?.shapes ?? []),
  };
}

export async function getMergedVehicles() {
  return (await getLiveData()).vehicles;
}

const VEHICLE_MODES = {
  metro: ['metro'],
  tram: ['tram'],
  rail: ['rail'],
  flytog: ['rail', 'flytog'],
  flybuss: ['bus', 'coach'],
};

/** Teller kjøretøy som kjører linjen, inkl. x-varianter (aliaser). Filtrerer også på transportmåte, siden
 * linjekoder som 5 og 12 også brukes av busser utenfor Oslo. */
export function countVehiclesForLine(vehicles, line) {
  const codes = new Set([line.code, ...(line.aliases ?? [])].map((c) => c.toUpperCase()));
  const modes = VEHICLE_MODES[line.mode];
  let n = 0;
  for (const v of vehicles ?? []) {
    if (modes && !modes.includes(String(v?.mode ?? '').toLowerCase())) continue;
    const code = v?.line?.publicCode;
    if (code && codes.has(String(code).toUpperCase())) n++;
  }
  return n;
}
