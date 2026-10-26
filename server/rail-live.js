/**
 * Tog i hele Norge inn i kjøretøylista: GPS-tog fra hele landet (rail-vehicles-cache.js) og
 * ET-tog uten GPS fra BNR (rail-et-service.js), slått sammen med Oslo-lista fra vehicles-cache.js.
 * Togene innenfor Oslo-boksen finnes i begge GPS-listene; de dedupliseres på vehicleId.
 */

import { getCachedRailVehicles } from './rail-vehicles-cache.js';
import { createRailEtService, trainKey } from './rail-et-service.js';

const NO_VEHICLES = Object.freeze([]);
const listOf = (data) => (Array.isArray(data?.data?.vehicles) ? data.data.vehicles : []);

/** trainKey for alle GPS-kjøretøy som har tognummer + dato i id-en. */
export function gpsTrainKeys(...lists) {
  const keys = new Set();
  for (const list of lists) {
    for (const v of list ?? []) {
      const k = trainKey(v?.vehicleId);
      if (k) keys.add(k);
    }
  }
  return keys;
}

/**
 * Oslo-lista først (uendret), deretter GPS-tog utenfor den og til slutt ET-tog uten GPS.
 * Gir samme form som getCachedVehicles ({ data: { vehicles } }), så resten av koden er uendret.
 */
export function mergeRailVehicles(vehiclesData, railGps, railEt) {
  const base = listOf(vehiclesData);
  const seen = new Set(base.map((v) => v?.vehicleId));
  const vehicles = base.slice();
  for (const list of [railGps, railEt]) {
    for (const v of list ?? []) {
      if (!v?.vehicleId || seen.has(v.vehicleId)) continue;
      seen.add(v.vehicleId);
      vehicles.push(v);
    }
  }
  return { ...vehiclesData, data: { ...(vehiclesData?.data ?? {}), vehicles } };
}

/**
 * @param {{ getRail?: () => Promise<object>, railEt?: { getVehicles: (keys: Set<string>) => object[] } }} [deps]
 */
export function createRailLive({ getRail = getCachedRailVehicles, railEt = createRailEtService() } = {}) {
  let keysFor = null; // { a, b, keys }
  let last = null; // { vehiclesData, railData, etVehicles, out }

  /** Gir samme objekt så lenge kildene er de samme (memoEntry i server.js bygger da ikke på nytt). */
  return async function withNationalRail(vehiclesData) {
    let railData = null;
    try {
      railData = await getRail();
    } catch {
      railData = null;
    }
    if (!keysFor || keysFor.a !== vehiclesData || keysFor.b !== railData) {
      keysFor = { a: vehiclesData, b: railData, keys: gpsTrainKeys(listOf(vehiclesData), listOf(railData)) };
    }
    let etVehicles = NO_VEHICLES;
    try {
      etVehicles = railEt.getVehicles(keysFor.keys);
    } catch (e) {
      console.warn('[RuterLive] Tog-ET:', e.message);
    }
    if (last && last.vehiclesData === vehiclesData && last.railData === railData && last.etVehicles === etVehicles) {
      return last.out;
    }
    const out = mergeRailVehicles(vehiclesData, listOf(railData), etVehicles);
    last = { vehiclesData, railData, etVehicles, out };
    return out;
  };
}

let shared = null;
/** Delt instans for server.js og live-vehicles.js. */
export function withNationalRail(vehiclesData) {
  if (!shared) shared = createRailLive();
  return shared(vehiclesData);
}
