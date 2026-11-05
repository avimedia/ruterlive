/**
 * Slår sammen kjøretøy fra Entur GraphQL og SIRI ET, samt rutekart.
 * Hjelperne brukes av regionregisteret (region-services.js); getLiveData/getMergedVehicles av linjesidene.
 */

import { matchRouteForVehicle } from '../shared/route-match.js';
// Syklisk import (region-services bruker hjelperne her); trygt, bare funksjonsdeklarasjoner brukes på tvers
import { getRegionServices } from './region-services.js';

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
 * @param {{ vehicles?: object[] }} etResult svar fra etVehicles.getVehiclesAndShapes()
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
        ? { ...v, from: v.from ?? et.from, to: v.to ?? et.to, via: v.via ?? et.via, ...(et.delay ? { delay: et.delay } : {}) }
        : v
    );
  }
  const seen = new Set(graphqlVehicles.map((v) => v.vehicleId));
  for (const v of etVehicles) {
    if (!seen.has(v.vehicleId)) merged.push(v);
  }
  return merged;
}

/** Kjøretøy uten fra/til (typisk GPS: tog, flybuss) får dem fra et rutekart for linjen og destinasjonen. */
export function withRouteInfo(vehicles, shapes) {
  if (!shapes?.length) return vehicles;
  return vehicles.map((v) => {
    if (v.from && v.to) return v;
    const m = matchRouteForVehicle(v, shapes);
    return m ? { ...v, from: v.from || m.from, to: v.to || m.to, via: v.via ?? m.via } : v;
  });
}

/** Gammelt format (/api/initial-data) uten nyere felt som `delay`, så svaret er uendret for gamle klienter. */
export function withoutDelay(vehicles) {
  return vehicles.map((v) => {
    if (v?.delay === undefined) return v;
    const { delay, ...rest } = v;
    return rest;
  });
}

function servicesFor(regionId) {
  const s = getRegionServices(regionId);
  if (!s) throw new Error(`Ukjent eller skjult region: ${regionId}`);
  return s;
}

/**
 * Sammenslåtte kjøretøy og rutekart (statiske + ET) for regionen.
 * @returns {Promise<{ vehicles: object[], routeShapes: object[] }>}
 */
export async function getLiveData(regionId = 'oslo') {
  const s = servicesFor(regionId);
  const { vehiclesData, etResult } = await s.live.getLiveSources();
  return {
    vehicles: mergeVehicles(vehiclesData, etResult),
    routeShapes: mergeShapes(s.live.getAllShapes(), etResult?.shapes ?? []),
  };
}

/** Bare kjøretøyene (linjesidene); bygger ikke rutekartene. */
export async function getMergedVehicles(regionId = 'oslo') {
  const { vehiclesData, etResult } = await servicesFor(regionId).live.getLiveSources();
  return mergeVehicles(vehiclesData, etResult);
}

const VEHICLE_MODES = {
  metro: ['metro'],
  tram: ['tram'],
  rail: ['rail'],
  flytog: ['rail', 'flytog'],
  flybuss: ['bus', 'coach'],
  bus: ['bus'],
  water: ['water', 'boat'],
};

/** Teller kjøretøy som kjører linjen, inkl. x-varianter (aliaser). Filtrerer også på transportmåte, siden
 * linjekoder som 5 og 12 også brukes av busser utenfor Oslo. Har kjøretøyet linje-ID (`RUT:Line:31`),
 * må den tilhøre linjens operatør, så Ruters 22 ikke telles med Brakars 22. */
export function countVehiclesForLine(vehicles, line) {
  const codes = new Set([line.code, ...(line.aliases ?? [])].map((c) => c.toUpperCase()));
  const modes = VEHICLE_MODES[line.mode];
  let n = 0;
  for (const v of vehicles ?? []) {
    if (modes && !modes.includes(String(v?.mode ?? '').toLowerCase())) continue;
    const ref = v?.line?.lineRef ?? v?.line?.ref;
    if (typeof ref === 'string' && ref && !ref.startsWith(`${line.authority}:`)) continue;
    const code = v?.line?.publicCode;
    if (code && codes.has(String(code).toUpperCase())) n++;
  }
  return n;
}
