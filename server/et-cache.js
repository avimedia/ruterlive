/**
 * Server-side cache av ET (Estimated Timetable). Reduserer kall mot Entur og unngår 429 rate limit.
 * Alle brukere får samme cache – 1 kall til Entur per oppdatering, ikke per bruker.
 */

import { fetchWithRetry } from './fetch-with-retry.js';

const ET_URL = 'https://api.entur.io/realtime/v1/rest/et?datasetId=RUT&maxSize=3000';
const CLIENT_NAME = 'ruterlive-web';
const REFRESH_MS = 30000; // 30 sekund

let cachedXml = '';
let lastFetch = 0;
let refreshPromise = null;

async function doRefresh() {
  const res = await fetchWithRetry(
    ET_URL,
    { headers: { 'ET-Client-Name': CLIENT_NAME } },
    { timeout: 60000, retries: 2 }
  );
  if (res.status === 429) {
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
      console.warn('[RuterLive] ET refresh failed, using cache:', err.message);
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
  setInterval(refresh, REFRESH_MS);
}
