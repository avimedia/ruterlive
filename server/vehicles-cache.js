/**
 * Server-side cache av GraphQL kjøretøy. Reduserer kall mot Entur og 502-feil.
 */

import { fetchWithRetry } from './fetch-with-retry.js';

const GRAPHQL_URL = 'https://api.entur.io/realtime/v2/vehicles/graphql';
const CLIENT_NAME = 'ruterlive-web';
const CACHE_MS = 20000; // 20 sekund

const OSLO_BOUNDS = { minLat: 59.45, maxLat: 60.2, minLon: 10.15, maxLon: 11.25 };

const VEHICLES_QUERY = `{
  vehicles(boundingBox: { minLat: ${OSLO_BOUNDS.minLat}, maxLat: ${OSLO_BOUNDS.maxLat}, minLon: ${OSLO_BOUNDS.minLon}, maxLon: ${OSLO_BOUNDS.maxLon} }) {
    vehicleId
    lastUpdated
    location { latitude longitude }
    line { publicCode }
    mode
    bearing
    destinationName
  }
}`;

let cachedData = null;
let lastFetch = 0;
let fetchPromise = null;

async function doFetch() {
  const res = await fetchWithRetry(
    GRAPHQL_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ET-Client-Name': CLIENT_NAME },
      body: JSON.stringify({ query: VEHICLES_QUERY }),
    },
    { timeout: 15000, retries: 2 }
  );
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0]?.message || 'GraphQL-feil');
  return data;
}

async function refresh() {
  try {
    const data = await doFetch();
    cachedData = data;
    lastFetch = Date.now();
    return data;
  } finally {
    fetchPromise = null;
  }
}

/** Returnerer cachet data. Ved utløpt cache: returnerer stale umiddelbart og revaliderer i bakgrunnen. */
export async function getCachedVehicles() {
  if (cachedData && Date.now() - lastFetch <= CACHE_MS) {
    return cachedData;
  }
  if (!fetchPromise) fetchPromise = refresh();
  if (cachedData) {
    fetchPromise.finally(() => { fetchPromise = null; });
    return cachedData;
  }
  await fetchPromise;
  fetchPromise = null;
  return cachedData;
}
