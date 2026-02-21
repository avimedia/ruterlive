/**
 * Server-side cache av ET (Estimated Timetable). Reduserer kall mot Entur og unngår 429 rate limit.
 * Alle brukere får samme cache – 1 kall til Entur per oppdatering, ikke per bruker.
 */

import { fetchWithRetry } from './fetch-with-retry.js';

const ET_URL = 'https://api.entur.io/realtime/v1/rest/et?datasetId=RUT&maxSize=3000';
const CLIENT_NAME = 'ruterlive-web';
const REFRESH_MS = 90000; // 90 sek – færre kall mot Entur
const BACKOFF_AFTER_429_MS = 300000; // 5 min venting ved 429

let cachedXml = '';
let lastFetch = 0;
let last429At = 0;
let last429LoggedAt = 0;
let refreshPromise = null;

async function doRefresh() {
  const res = await fetchWithRetry(
    ET_URL,
    { headers: { 'ET-Client-Name': CLIENT_NAME } },
    { timeout: 60000, retries: 1 }
  );
  if (res.status === 429) {
    last429At = Date.now();
    throw new Error('429 Rate limit – prøv igjen om litt');
  }
  if (!res.ok) throw new Error(`ET ${res.status}`);
  cachedXml = await res.text();
  lastFetch = Date.now();
  return cachedXml;
}

async function refresh() {
  try {
    const result = await doRefresh();
    return result;
  } catch (err) {
    if (cachedXml) {
      if (Date.now() - last429LoggedAt > BACKOFF_AFTER_429_MS) {
        last429LoggedAt = Date.now();
        console.warn('[RuterLive] ET 429 – bruker cache, venter 5 min');
      }
      return cachedXml;
    }
    throw err;
  } finally {
    refreshPromise = null;
  }
}

export function getCachedEt() {
  return cachedXml;
}

export function getEtAge() {
  return lastFetch ? Date.now() - lastFetch : null;
}

export async function ensureEtCache() {
  if (cachedXml && Date.now() - lastFetch <= REFRESH_MS) {
    return cachedXml;
  }
  if (!refreshPromise) {
    refreshPromise = refresh();
  }
  await refreshPromise;
  return cachedXml;
}

export function startEtCachePoll() {
  refresh();
  setInterval(() => {
    const since429 = Date.now() - last429At;
    if (last429At && since429 < BACKOFF_AFTER_429_MS) return; // Vent etter 429
    refresh();
  }, REFRESH_MS);
}
