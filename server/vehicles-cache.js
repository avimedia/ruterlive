/**
 * Server-side cache av GraphQL kjøretøy. Reduserer kall mot Entur og 502-feil.
 */

import { normalizeGpsVehicles } from '../shared/gps-vehicles.js';
import { fetchWithRetry } from './fetch-with-retry.js';
import { CLIENT_NAME } from './entur-client.js';
import { serverVisibleRegions } from './region-preview.js';

const GRAPHQL_URL = 'https://api.entur.io/realtime/v2/vehicles/graphql';
const CACHE_MS = 20000; // 20 sekund
/** Hvor lenge en region som feiler beholder forrige liste før den blir tom (ellers står gamle kjøretøy stille på kartet). */
export const STALE_REGION_MS = 3 * 60 * 1000;

const FIELDS = `
    vehicleId
    lastUpdated
    location { latitude longitude }
    line { publicCode lineRef }
    mode
    bearing
    destinationName
    serviceJourney { id }`;

/** Ett GraphQL-kall med ett alias per region: `oslo: vehicles(boundingBox: …) { … }`. */
export function buildVehiclesQuery(regions) {
  const parts = regions.map((r) => {
    if (!/^[a-z_]\w*$/i.test(r.id)) throw new Error(`Ugyldig region-id for GraphQL-alias: ${r.id}`);
    const b = r.vehicleBounds;
    return `  ${r.id}: vehicles(boundingBox: { minLat: ${b.minLat}, maxLat: ${b.maxLat}, minLon: ${b.minLon}, maxLon: ${b.maxLon} }) {${FIELDS}
  }`;
  });
  return `{\n${parts.join('\n')}\n}`;
}

/**
 * Cache for GPS-kjøretøy. `getRegions` gir regionene som skal hentes (kan injiseres i tester).
 * getCachedVehicles(regionId) gir `{ data: { vehicles } }` for den regionen.
 */
const EMPTY = Object.freeze({ data: Object.freeze({ vehicles: Object.freeze([]) }) });

export function createVehiclesCache({ getRegions = serverVisibleRegions, fetchFn = fetchWithRetry } = {}) {
  let cachedData = null; // { [regionId]: { data: { vehicles } } } – bygges én gang per henting (stabil identitet for memo-cacher)
  let lastFetch = 0;
  let fetchPromise = null;
  const okAt = {}; // regionId → tid for siste vellykkede liste

  async function doFetch() {
    const regions = getRegions();
    const res = await fetchFn(
      GRAPHQL_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
        body: JSON.stringify({ query: buildVehiclesQuery(regions) }),
      },
      { timeout: 15000, retries: 2 }
    );
    const data = await res.json();
    // Delvis feil (f.eks. tidsavbrudd for ett alias): de andre regionene beholder sine kjøretøy
    const ok = regions.filter((r) => Array.isArray(data?.data?.[r.id]));
    if (data?.errors && ok.length === 0) throw new Error(data.errors[0]?.message || 'GraphQL-feil');
    const byRegion = {};
    const failed = [];
    for (const r of regions) {
      if (ok.includes(r)) {
        byRegion[r.id] = { data: { vehicles: normalizeGpsVehicles(data.data[r.id]) } };
        okAt[r.id] = Date.now();
      } else {
        failed.push(r.id);
        const fresh = okAt[r.id] != null && Date.now() - okAt[r.id] <= STALE_REGION_MS;
        byRegion[r.id] = (fresh && cachedData?.[r.id]) || EMPTY; // forrige liste (samme objekt) en stund, så tom
      }
    }
    if (failed.length && data?.errors) {
      console.warn(`[RuterLive] Kjøretøy: GraphQL-feil for ${failed.join(', ')} (${data.errors[0]?.message || 'ukjent'}), bruker forrige liste`);
    }
    return byRegion;
  }

  async function refresh() {
    try {
      cachedData = await doFetch();
      lastFetch = Date.now();
      return cachedData;
    } finally {
      fetchPromise = null;
    }
  }

  const answer = (regionId) => cachedData?.[regionId] || EMPTY;

  /** Ved utløpt cache: returnerer stale umiddelbart og revaliderer i bakgrunnen. */
  return async function getCachedVehicles(regionId = 'oslo') {
    if (cachedData && Date.now() - lastFetch <= CACHE_MS) return answer(regionId);
    if (!fetchPromise) fetchPromise = refresh();
    if (cachedData) {
      // Bakgrunnsrevalidering: feil skal logges, ikke bli en uhåndtert rejection som dreper prosessen.
      fetchPromise
        .then(() => {}, (e) => console.warn('[RuterLive] Kjøretøy-revalidering:', e.message))
        .finally(() => { fetchPromise = null; });
      return answer(regionId);
    }
    await fetchPromise;
    fetchPromise = null;
    return answer(regionId);
  };
}

export const getCachedVehicles = createVehiclesCache();
