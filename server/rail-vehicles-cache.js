/**
 * Tog med GPS i hele Norge (Vy, Go-Ahead, Flytoget): Entur Vehicles `vehicles(mode: RAIL)` uten bbox.
 * Oslo-spørringen i vehicles-cache.js har bare togene innenfor Oslo-boksen; her kommer resten.
 * Ett kall per 30 s for alle brukere (~35 kB fra Entur), samme mønster som vehicles-cache.js:
 * stale-while-revalidate, ett kall om gangen, feil logges.
 */

import { normalizeGpsVehicles } from '../shared/gps-vehicles.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { CLIENT_NAME } from './entur-client.js';

const GRAPHQL_URL = 'https://api.entur.io/realtime/v2/vehicles/graphql';
const CACHE_MS = 30000;
const FAILURE_LOG_MS = 5 * 60 * 1000;

const RAIL_QUERY = `{
  vehicles(mode: RAIL) {
    vehicleId
    lastUpdated
    location { latitude longitude }
    line { publicCode lineRef }
    mode
    bearing
    destinationName
  }
}`;

/** Samme tomme svar ved feil før første henting, så memoiserte svar kan gjenbrukes. */
export const EMPTY_RAIL = Object.freeze({ data: Object.freeze({ vehicles: Object.freeze([]) }) });

/** Rydder GraphQL-svaret: bare tog med posisjon, modus satt eksplisitt til 'rail'. */
export function normalizeRailVehicles(vehicles) {
  const out = [];
  for (const v of normalizeGpsVehicles(vehicles)) {
    const lat = v?.location?.latitude;
    const lon = v?.location?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ ...v, mode: 'rail' });
  }
  return out;
}

/**
 * @param {{ fetchFn?: Function, now?: () => number, cacheMs?: number }} [opts]
 */
export function createRailVehiclesCache({ fetchFn = fetchWithRetry, now = () => Date.now(), cacheMs = CACHE_MS } = {}) {
  let cached = null;
  let lastFetch = -Infinity;
  let pending = null;
  let lastWarn = -Infinity;

  async function doFetch() {
    const res = await fetchFn(
      GRAPHQL_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
        body: JSON.stringify({ query: RAIL_QUERY }),
      },
      { timeout: 15000, retries: 1 }
    );
    if (!res.ok) throw new Error(`Vehicles ${res.status}`);
    const data = await res.json();
    if (data?.errors?.length) throw new Error(data.errors[0]?.message || 'GraphQL-feil');
    return Object.freeze({ data: Object.freeze({ vehicles: Object.freeze(normalizeRailVehicles(data?.data?.vehicles)) }) });
  }

  function refresh() {
    if (!pending) {
      pending = doFetch()
        .then((d) => {
          cached = d;
          lastFetch = now();
          return d;
        })
        .finally(() => { pending = null; });
    }
    return pending;
  }

  /** Avviser aldri: gir siste svar (eller EMPTY_RAIL) og revaliderer i bakgrunnen når det er gammelt. */
  async function get() {
    if (now() - lastFetch <= cacheMs) return cached ?? EMPTY_RAIL;
    const p = refresh().catch((e) => {
      if (now() - lastWarn > FAILURE_LOG_MS) {
        lastWarn = now();
        console.warn('[RuterLive] Tog-GPS (hele landet):', e.message);
      }
      lastFetch = now(); // ikke nytt forsøk ved hver forespørsel etter feil
      return cached ?? EMPTY_RAIL;
    });
    // Uten svar ennå: ikke la /api/vehicles-live vente på tog-GPS, Oslo-dataene er klare
    return cached ?? EMPTY_RAIL;
  }

  return { get };
}

const shared = createRailVehiclesCache();
export const getCachedRailVehicles = () => shared.get();
